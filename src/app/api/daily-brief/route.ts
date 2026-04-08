import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchGoogleNews, NewsItem } from '@/lib/news-fetcher'
import Anthropic from '@anthropic-ai/sdk'
import { sendDailyDigest } from '@/lib/send-digest'

export const dynamic = 'force-dynamic'

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) {
    throw new Error('CLAUDE_API_KEY is not set in environment')
  }
  return new Anthropic({ apiKey: key })
}

interface ContactWithTags {
  id: string
  name: string
  role: string | null
  company: string | null
  sector: string | null
  status: string | null
  tags: { tag: string }[]
  notes: { summary: string; full_notes: string | null }[]
}

interface CompanySlot {
  company: string
  contacts: ContactWithTags[]
  articles: NewsItem[]
  statusBoost: number // higher = better ranking
}

// GET handler for Vercel Cron
export async function GET(request: NextRequest) {
  return runDailyBrief(request)
}

export async function POST(request: NextRequest) {
  return runDailyBrief(request)
}

async function runDailyBrief(request: NextRequest) {
  try {
    // Step 1: Gather contacts
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, status, last_contact_date, follow_up_cadence_days, tags(tag), notes(summary, full_notes)')
      .neq('status', 'Dormant')

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ message: 'No contacts to search for', items: [] })
    }

    // Step 2: Build company → contacts map (deduplicate companies)
    const companyMap = new Map<string, ContactWithTags[]>()
    for (const contact of contacts) {
      if (!contact.company) continue
      const key = contact.company.toLowerCase().trim()
      if (!companyMap.has(key)) companyMap.set(key, [])
      companyMap.get(key)!.push(contact as ContactWithTags)
    }

    // Also collect tag-based search terms mapped to contacts
    const tagSearchTerms = new Map<string, ContactWithTags[]>()
    for (const contact of contacts) {
      for (const t of (contact.tags || [])) {
        const key = t.tag.toLowerCase()
        if (!tagSearchTerms.has(key)) tagSearchTerms.set(key, [])
        tagSearchTerms.get(key)!.push(contact as ContactWithTags)
      }
    }

    // Step 3: Fetch news for companies first, then tags
    const companySlots = new Map<string, CompanySlot>()

    // Search by company names (prioritized)
    const companyNames = Array.from(companyMap.keys()).slice(0, 15)
    for (const companyKey of companyNames) {
      const newsItems = await fetchGoogleNews(companyKey, 5)
      if (newsItems.length === 0) continue

      const companyContacts = companyMap.get(companyKey)!
      const displayName = companyContacts[0].company || companyKey

      // Status boost: Active=2, Warm=1, else 0
      const bestStatus = companyContacts.reduce((best, c) => {
        const score = c.status === 'Active' ? 2 : c.status === 'Warm' ? 1 : 0
        return Math.max(best, score)
      }, 0)

      companySlots.set(companyKey, {
        company: displayName,
        contacts: companyContacts,
        articles: newsItems,
        statusBoost: bestStatus,
      })
    }

    // Search by tags (fill remaining slots)
    const tagTerms = Array.from(tagSearchTerms.keys()).slice(0, 10)
    for (const tag of tagTerms) {
      const newsItems = await fetchGoogleNews(tag, 3)
      if (newsItems.length === 0) continue

      const tagContacts = tagSearchTerms.get(tag)!
      // Group these articles under the contact's company if possible
      for (const contact of tagContacts) {
        if (!contact.company) continue
        const key = contact.company.toLowerCase().trim()
        if (companySlots.has(key)) {
          // Add articles to existing company slot (deduplicate by URL)
          const slot = companySlots.get(key)!
          const existingUrls = new Set(slot.articles.map(a => a.link))
          for (const item of newsItems) {
            if (!existingUrls.has(item.link)) {
              slot.articles.push(item)
              existingUrls.add(item.link)
            }
          }
        } else {
          const bestStatus = contact.status === 'Active' ? 2 : contact.status === 'Warm' ? 1 : 0
          companySlots.set(key, {
            company: contact.company,
            contacts: [contact],
            articles: newsItems,
            statusBoost: bestStatus,
          })
        }
      }
    }

    if (companySlots.size === 0) {
      return NextResponse.json({ message: 'No news found', items: [] })
    }

    // Step 4: Deduplicate against existing daily_briefs
    const { data: existing } = await supabase
      .from('daily_briefs')
      .select('company')

    const existingCompanies = new Set(
      existing?.map((e) => e.company?.toLowerCase().trim()) || []
    )

    // Filter out companies we've already briefed today
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const { data: todayBriefs } = await supabase
      .from('daily_briefs')
      .select('company')
      .gte('created_at', startOfDay)

    const todayCompanies = new Set(
      todayBriefs?.map((e) => e.company?.toLowerCase().trim()) || []
    )

    // Step 5: Filter to eligible companies, take wider pool for AI scoring
    const eligibleSlots = Array.from(companySlots.values())
      .filter(slot => !todayCompanies.has(slot.company.toLowerCase().trim()))
      .slice(0, 12) // Analyze up to 12, then pick best 5 by AI relevance

    if (eligibleSlots.length === 0) {
      return NextResponse.json({ message: 'No new companies to brief', items: [] })
    }

    // Step 6: AI analysis per company — analyze all eligible, then rank by relevance
    const allAnalyzed = []
    for (const slot of eligibleSlots) {
      const analysis = await analyzeCompanySlot(slot)
      if (analysis) {
        allAnalyzed.push(analysis)
      }
    }

    // Step 7: Rank by AI-determined relevance + status boost
    // Relevance score: High=3, Medium=2, Low=1
    // Status boost: Active=2, Warm=1, else 0
    // Final score = relevance * 3 + status boost (relevance dominates)
    const results = allAnalyzed
      .sort((a, b) => {
        const relScore = { High: 3, Medium: 2, Low: 1 }
        const scoreA = (relScore[a.relevance as keyof typeof relScore] ?? 1) * 3 + a.statusBoost
        const scoreB = (relScore[b.relevance as keyof typeof relScore] ?? 1) * 3 + b.statusBoost
        return scoreB - scoreA
      })
      .slice(0, 5)

    // Step 7: Store in daily_briefs (one row per company)
    const toInsert = results.map((r) => ({
      company: r.company,
      headline: r.contact_name, // Store contact name in headline field
      source_url: null,
      ai_summary: JSON.stringify({
        articles: r.articles,
        synthesis: r.synthesis,
        contact_name: r.contact_name,
      }),
      relevance: r.relevance,
      draft_email: JSON.stringify({
        modular: r.modular_emails,
        combined: r.combined_email,
      }),
      contact_id: r.contact_id,
      status: 'New',
    }))

    if (toInsert.length > 0) {
      await supabase.from('daily_briefs').insert(toInsert)
    }

    // Step 8: Calculate follow-ups and send email
    const allContacts = contacts || []
    const upcomingFollowUps = []
    const overdueFollowUps = []

    for (const c of allContacts) {
      if (!c.last_contact_date) continue
      const last = new Date(c.last_contact_date as string)
      const cadence = (c as unknown as { follow_up_cadence_days: number }).follow_up_cadence_days || 60
      const dueDate = new Date(last.getTime() + cadence * 24 * 60 * 60 * 1000)
      const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      if (diffDays < 0) {
        overdueFollowUps.push({ name: c.name, company: c.company, last_contact_date: c.last_contact_date as string, days_overdue: Math.abs(diffDays) })
      } else if (diffDays <= 7) {
        upcomingFollowUps.push({ name: c.name, company: c.company, last_contact_date: c.last_contact_date as string, days_until_due: diffDays })
      }
    }

    const appUrl = new URL('/', request.url).toString()

    const digestItems = results.map((r) => ({
      company: r.company,
      contact_name: r.contact_name,
      articles: r.articles,
      synthesis: r.synthesis,
      relevance: r.relevance,
      modular_emails: r.modular_emails,
      combined_email: r.combined_email,
    }))

    const emailResult = await sendDailyDigest(digestItems, upcomingFollowUps, overdueFollowUps, appUrl)

    return NextResponse.json({
      success: true,
      companies: results.length,
      results,
      email: emailResult,
    })
  } catch (err) {
    console.error('Daily brief failed:', err)
    return NextResponse.json(
      { error: 'Daily brief failed', details: String(err) },
      { status: 500 }
    )
  }
}

async function analyzeCompanySlot(slot: CompanySlot) {
  const primaryContact = slot.contacts[0]
  const contactNames = [...new Set(slot.contacts.map(c => c.name))].join(', ')

  // Get recent notes from all contacts at this company
  const allNotes = slot.contacts
    .flatMap(c => (c.notes || []).slice(0, 2))
    .map(n => n.summary)
    .slice(0, 4)
    .join('; ')

  const articlesList = slot.articles.slice(0, 5).map((a, i) =>
    `Article ${i + 1}:\n  Headline: ${a.title}\n  Source: ${a.source}\n  Date: ${a.pubDate}`
  ).join('\n\n')

  const notesContext = allNotes
    ? `\nRecent conversation notes: ${allNotes}`
    : ''

  const emailGuidance = allNotes
    ? 'Reference our past conversation naturally ("Since we last spoke about..." or "This reminded me of our conversation about...")'
    : 'Keep it warm but general ("I\'ve been following [company] and thought you\'d find this interesting...")'

  const prompt = `You are a healthcare networking CRM assistant. Analyze these news articles about ${slot.company} for relevance to my contact(s).

ARTICLES ABOUT ${slot.company.toUpperCase()}:
${articlesList}

CONTACT(S):
${slot.contacts.map(c => `- ${c.name} (${c.role || 'Unknown role'}, ${c.sector || 'Unknown sector'})`).join('\n')}
Tags: ${[...new Set(slot.contacts.flatMap(c => c.tags?.map(t => t.tag) || []))].join(', ') || 'None'}${notesContext}

RELEVANCE SCORING — this is the most important field. Score based on how actionable and interesting the news is for a healthcare investor/operator networking context:
- "High": News I could immediately use as a reason to reach out — funding rounds, acquisitions, executive moves, major partnerships, regulatory decisions that directly affect the contact's work. The kind of thing that makes someone say "I should email them about this today."
- "Medium": Relevant industry trends, competitor activity, or sector developments worth knowing — good conversation fodder but not an urgent reason to reach out.
- "Low": Tangentially related news, generic industry coverage, or press releases with little substance. Not worth a dedicated outreach.

Quality matters more than quantity. One highly actionable article should score "High" even if it's the only article. Many generic articles should still score "Low."

Generate the following as JSON:
{
  "relevance": "High" or "Medium" or "Low",
  "articles": [
    {
      "headline": "exact article headline",
      "source_url_index": 0,
      "summary": "1-2 sentence summary of what happened and why it matters"
    }
  ],
  "synthesis": "One paragraph synthesizing all the articles together — what's the bigger picture for this company?",
  "modular_emails": [
    "One standalone substance line per article that could be used in an email (e.g., 'I saw that [company] just [news]. [Brief analytical take].')"
  ],
  "combined_email": "A complete personalized email weaving all the articles together. ${emailGuidance}. Add value with analytical takes. Make a soft ask (coffee, call, or just catching up). Tone: professional but personal, warm, not salesy. Sign off as Sammy."
}

Return ONLY valid JSON, no other text.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0])

    // Map article source URLs back
    const articlesWithUrls = (parsed.articles || []).map((a: { headline: string; source_url_index: number; summary: string }, i: number) => ({
      headline: a.headline,
      url: slot.articles[a.source_url_index ?? i]?.link || slot.articles[0]?.link || '',
      summary: a.summary,
    }))

    return {
      company: slot.company,
      contact_name: contactNames,
      contact_id: primaryContact.id,
      relevance: parsed.relevance || 'Medium',
      statusBoost: slot.statusBoost,
      articles: articlesWithUrls,
      synthesis: parsed.synthesis || '',
      modular_emails: parsed.modular_emails || [],
      combined_email: parsed.combined_email || '',
    }
  } catch (err) {
    console.error(`AI analysis failed for "${slot.company}":`, err)
    return null
  }
}
