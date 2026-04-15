import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchGoogleNews, fetchFromCustomSources, NewsItem } from '@/lib/news-fetcher'
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

// Source reputation tiers for deduplication
const SOURCE_TIERS: Record<string, number> = {
  'stat news': 1, 'statnews': 1, 'techcrunch': 1, 'wsj': 1, 'wall street journal': 1,
  'bloomberg': 1, 'modern healthcare': 1, 'fierce healthcare': 1, 'medcity news': 1,
  'axios': 2, 'forbes': 2, 'business insider': 2,
  'pr newswire': 3, 'globenewswire': 3, 'businesswire': 3, 'business wire': 3, 'finsmes': 3,
}

function getSourceTier(source: string): number {
  const lower = source.toLowerCase().trim()
  for (const [name, tier] of Object.entries(SOURCE_TIERS)) {
    if (lower.includes(name)) return tier
  }
  return 2 // Default to Tier 2 for unknown sources
}

// Deduplicate articles covering the same story, keeping the most reputable source
function deduplicateArticles(articles: NewsItem[]): NewsItem[] {
  // Group by rough similarity — articles about the same event share key terms
  const groups: { representative: NewsItem; tier: number; members: NewsItem[] }[] = []

  for (const article of articles) {
    const titleWords = new Set(
      article.title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    )

    let matched = false
    for (const group of groups) {
      const groupWords = new Set(
        group.representative.title.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3)
      )
      // Check overlap — if >50% of words match, it's the same story
      const overlap = [...titleWords].filter(w => groupWords.has(w)).length
      const similarity = overlap / Math.min(titleWords.size, groupWords.size)

      if (similarity > 0.5) {
        group.members.push(article)
        const articleTier = getSourceTier(article.source)
        if (articleTier < group.tier) {
          group.representative = article
          group.tier = articleTier
        }
        matched = true
        break
      }
    }

    if (!matched) {
      groups.push({
        representative: article,
        tier: getSourceTier(article.source),
        members: [article],
      })
    }
  }

  return groups.map(g => g.representative)
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
  statusBoost: number
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

    // Step 2: Build company → contacts map
    const companyMap = new Map<string, ContactWithTags[]>()
    for (const contact of contacts) {
      if (!contact.company) continue
      const key = contact.company.toLowerCase().trim()
      if (!companyMap.has(key)) companyMap.set(key, [])
      companyMap.get(key)!.push(contact as ContactWithTags)
    }

    const tagSearchTerms = new Map<string, ContactWithTags[]>()
    for (const contact of contacts) {
      for (const t of (contact.tags || [])) {
        const key = t.tag.toLowerCase()
        if (!tagSearchTerms.has(key)) tagSearchTerms.set(key, [])
        tagSearchTerms.get(key)!.push(contact as ContactWithTags)
      }
    }

    // Step 3: Fetch news
    const companySlots = new Map<string, CompanySlot>()

    const companyNames = Array.from(companyMap.keys()).slice(0, 15)
    for (const companyKey of companyNames) {
      const newsItems = await fetchGoogleNews(companyKey, 8) // Fetch more to allow for dedup
      if (newsItems.length === 0) continue

      const companyContacts = companyMap.get(companyKey)!
      const displayName = companyContacts[0].company || companyKey
      const bestStatus = companyContacts.reduce((best, c) => {
        const score = c.status === 'Active' ? 2 : c.status === 'Warm' ? 1 : 0
        return Math.max(best, score)
      }, 0)

      // Deduplicate articles by same story, keeping best source
      const deduped = deduplicateArticles(newsItems)

      companySlots.set(companyKey, {
        company: displayName,
        contacts: companyContacts,
        articles: deduped.slice(0, 3), // Max 3 articles per company
        statusBoost: bestStatus,
      })
    }

    const tagTerms = Array.from(tagSearchTerms.keys()).slice(0, 10)
    for (const tag of tagTerms) {
      const newsItems = await fetchGoogleNews(tag, 3)
      if (newsItems.length === 0) continue

      const tagContacts = tagSearchTerms.get(tag)!
      for (const contact of tagContacts) {
        if (!contact.company) continue
        const key = contact.company.toLowerCase().trim()
        if (companySlots.has(key)) {
          const slot = companySlots.get(key)!
          const combined = [...slot.articles, ...newsItems]
          const existingUrls = new Set<string>()
          const unique = combined.filter(a => {
            if (existingUrls.has(a.link)) return false
            existingUrls.add(a.link)
            return true
          })
          slot.articles = deduplicateArticles(unique).slice(0, 3)
        } else {
          const bestStatus = contact.status === 'Active' ? 2 : contact.status === 'Warm' ? 1 : 0
          const deduped = deduplicateArticles(newsItems)
          companySlots.set(key, {
            company: contact.company,
            contacts: [contact],
            articles: deduped.slice(0, 3),
            statusBoost: bestStatus,
          })
        }
      }
    }

    // Step 3b: Pull articles from user-saved RSS sources and match against
    // tracked companies / tags. One broken feed doesn't block the rest.
    const { data: savedSources } = await supabase
      .from('news_sources')
      .select('name, url')

    if (savedSources && savedSources.length > 0) {
      const customItems = await fetchFromCustomSources(
        savedSources.map((s) => ({ name: s.name as string, url: s.url as string })),
        10
      )

      const mergeIntoSlot = (key: string, displayName: string, contactList: ContactWithTags[], item: NewsItem) => {
        const existing = companySlots.get(key)
        if (existing) {
          const combined = [...existing.articles, item]
          const seen = new Set<string>()
          const unique = combined.filter((a) => {
            if (seen.has(a.link)) return false
            seen.add(a.link)
            return true
          })
          existing.articles = deduplicateArticles(unique).slice(0, 3)
        } else {
          const bestStatus = contactList.reduce((best, c) => {
            const score = c.status === 'Active' ? 2 : c.status === 'Warm' ? 1 : 0
            return Math.max(best, score)
          }, 0)
          companySlots.set(key, {
            company: displayName,
            contacts: contactList,
            articles: [item],
            statusBoost: bestStatus,
          })
        }
      }

      for (const item of customItems) {
        const haystack = item.title.toLowerCase()
        if (!haystack) continue

        // Company name match
        let matched = false
        for (const [companyKey, companyContacts] of companyMap.entries()) {
          if (companyKey.length >= 3 && haystack.includes(companyKey)) {
            const displayName = companyContacts[0].company || companyKey
            mergeIntoSlot(companyKey, displayName, companyContacts, item)
            matched = true
            break
          }
        }
        if (matched) continue

        // Tag match — attribute article to each matched contact's company
        for (const [tagKey, tagContacts] of tagSearchTerms.entries()) {
          if (tagKey.length < 3 || !haystack.includes(tagKey)) continue
          for (const contact of tagContacts) {
            if (!contact.company) continue
            const key = contact.company.toLowerCase().trim()
            mergeIntoSlot(key, contact.company, [contact], item)
          }
          break
        }
      }
    }

    if (companySlots.size === 0) {
      return NextResponse.json({ message: 'No news found', items: [] })
    }

    // Step 4: Filter out companies already briefed today
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const { data: todayBriefs } = await supabase
      .from('daily_briefs')
      .select('company')
      .gte('created_at', startOfDay)

    const todayCompanies = new Set(
      todayBriefs?.map((e) => e.company?.toLowerCase().trim()) || []
    )

    // Step 5: Take wider pool for AI scoring
    const eligibleSlots = Array.from(companySlots.values())
      .filter(slot => !todayCompanies.has(slot.company.toLowerCase().trim()))
      .slice(0, 12)

    if (eligibleSlots.length === 0) {
      return NextResponse.json({ message: 'No new companies to brief', items: [] })
    }

    // Step 6: AI analysis per company
    const allAnalyzed = []
    for (const slot of eligibleSlots) {
      const analysis = await analyzeCompanySlot(slot)
      if (analysis) {
        allAnalyzed.push(analysis)
      }
    }

    // Step 7: Rank by AI relevance + status boost
    const results = allAnalyzed
      .sort((a, b) => {
        const relScore = { High: 3, Medium: 2, Low: 1 }
        const scoreA = (relScore[a.relevance as keyof typeof relScore] ?? 1) * 3 + a.statusBoost
        const scoreB = (relScore[b.relevance as keyof typeof relScore] ?? 1) * 3 + b.statusBoost
        return scoreB - scoreA
      })
      .slice(0, 5)

    // Step 8: Store in daily_briefs
    const toInsert = results.map((r) => ({
      company: r.company,
      headline: r.contact_name,
      source_url: null,
      ai_summary: JSON.stringify({
        articles: r.articles,
        synthesis: r.synthesis,
        contact_name: r.contact_name,
      }),
      relevance: r.relevance,
      draft_email: JSON.stringify({
        options: r.email_options,
      }),
      contact_id: r.contact_id,
      status: 'New',
    }))

    if (toInsert.length > 0) {
      await supabase.from('daily_briefs').insert(toInsert)
    }

    // Step 9: Calculate follow-ups and send email
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
      email_options: r.email_options,
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

  const allNotes = slot.contacts
    .flatMap(c => (c.notes || []).slice(0, 2))
    .map(n => n.summary)
    .slice(0, 4)
    .join('; ')

  const articlesList = slot.articles.map((a, i) =>
    `Article ${i + 1}:\n  Headline: ${a.title}\n  Source: ${a.source}\n  Date: ${a.pubDate}`
  ).join('\n\n')

  const notesContext = allNotes
    ? `\nRecent conversation notes: ${allNotes}`
    : ''

  const emailGuidance = allNotes
    ? 'Reference our past conversation naturally ("Since we last spoke about..." or "This reminded me of our conversation about...")'
    : 'Keep it warm but general ("I\'ve been following [company] and thought you\'d find this interesting...")'

  const articleCount = slot.articles.length
  const optionLabels = articleCount === 1
    ? 'Generate 1 option based on the single article.'
    : articleCount === 2
    ? 'Generate 2 options (Option A and Option B), one per article.'
    : 'Generate 3 options (Option A, Option B, and Option C), one per article.'

  const prompt = `You are a healthcare networking CRM assistant. Analyze these news articles about ${slot.company} for relevance to my contact(s).

ARTICLES ABOUT ${slot.company.toUpperCase()}:
${articlesList}

CONTACT(S):
${slot.contacts.map(c => `- ${c.name} (${c.role || 'Unknown role'}, ${c.sector || 'Unknown sector'})`).join('\n')}
Tags: ${[...new Set(slot.contacts.flatMap(c => c.tags?.map(t => t.tag) || []))].join(', ') || 'None'}${notesContext}

RELEVANCE SCORING — this is the most important field. Score based on how actionable and interesting the news is for a healthcare investor/operator networking context:
- "High": News I could immediately use as a reason to reach out — funding rounds, acquisitions, executive moves, major partnerships, regulatory decisions that directly affect the contact's work.
- "Medium": Relevant industry trends, competitor activity, or sector developments worth knowing — good conversation fodder but not urgent.
- "Low": Tangentially related news, generic industry coverage, or press releases with little substance.

Quality matters more than quantity. One highly actionable article should score "High" even if it's the only article.

DEDUPLICATION: If multiple articles cover the same event or announcement, keep only the one with the most substance. The articles provided have already been partially deduplicated, but if you notice remaining duplicates, collapse them into one entry.

ARTICLE LIMIT: Return at most 3 articles, and only if they cover meaningfully different topics (e.g. a funding round vs. a regulatory change). If all articles are about the same topic, return only 1.

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
  "email_options": [
    {
      "label": "Option A: [angle name, e.g. Funding Round]",
      "full_email": "A complete email: warm opener, one substance sentence about this specific article, soft ask (coffee/call/catching up), signed Sammy. ${emailGuidance}. Tone: professional but personal, warm, not salesy."
    }
  ]
}

EMAIL OPTIONS: ${optionLabels} Each option should be a complete, standalone email anchored on one article's angle. The label format is "Option A: [Angle Name]" where the angle name is 2-3 words describing the news type (e.g. "Funding Round", "Market Trend", "Competitive Landscape", "Leadership Change", "Regulatory Shift"). Each email: warm opener → one substance line → soft ask → signed Sammy.

Return ONLY valid JSON, no other text.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0])

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
      email_options: parsed.email_options || [],
    }
  } catch (err) {
    console.error(`AI analysis failed for "${slot.company}":`, err)
    return null
  }
}
