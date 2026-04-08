import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchGoogleNews, NewsItem } from '@/lib/news-fetcher'
import Anthropic from '@anthropic-ai/sdk'
import { sendDailyDigest } from '@/lib/send-digest'

export const dynamic = 'force-dynamic'

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment')
  }
  return new Anthropic({ apiKey: key })
}

interface ContactWithTags {
  id: string
  name: string
  role: string | null
  company: string | null
  sector: string | null
  tags: { tag: string }[]
  notes: { summary: string; full_notes: string | null }[]
}

interface CandidateItem {
  newsItem: NewsItem
  contact: ContactWithTags
  searchTerm: string
}

// GET handler for Vercel Cron (cron jobs send GET requests)
export async function GET(request: NextRequest) {
  return runDailyBrief(request)
}

export async function POST(request: NextRequest) {
  return runDailyBrief(request)
}

async function runDailyBrief(request: NextRequest) {
  try {
    // Step 1: Gather search targets
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, last_contact_date, follow_up_cadence_days, tags(tag), notes(summary, full_notes)')
      .neq('status', 'Dormant')

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ message: 'No contacts to search for', items: [] })
    }

    // Collect unique search terms: companies + high-frequency tags
    const searchTerms: Map<string, ContactWithTags[]> = new Map()

    for (const contact of contacts) {
      if (contact.company) {
        const key = contact.company.toLowerCase()
        if (!searchTerms.has(key)) searchTerms.set(key, [])
        searchTerms.get(key)!.push(contact as ContactWithTags)
      }
      for (const t of (contact.tags || [])) {
        const key = t.tag.toLowerCase()
        if (!searchTerms.has(key)) searchTerms.set(key, [])
        searchTerms.get(key)!.push(contact as ContactWithTags)
      }
    }

    // Step 2: Search for news (limit total queries to avoid rate limits)
    const allTerms = Array.from(searchTerms.keys()).slice(0, 20)
    const candidates: CandidateItem[] = []

    for (const term of allTerms) {
      const newsItems = await fetchGoogleNews(term, 3)
      const relatedContacts = searchTerms.get(term)!

      for (const item of newsItems) {
        candidates.push({
          newsItem: item,
          contact: relatedContacts[0],
          searchTerm: term,
        })
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({ message: 'No news found', items: [] })
    }

    // Step 3: Deduplicate against existing daily_briefs by source URL
    const { data: existing } = await supabase
      .from('daily_briefs')
      .select('source_url, headline')

    const existingUrls = new Set(existing?.map((e) => e.source_url) || [])
    const existingHeadlines = new Set(existing?.map((e) => e.headline?.toLowerCase()) || [])

    const newCandidates = candidates.filter((c) => {
      if (existingUrls.has(c.newsItem.link)) return false
      if (existingHeadlines.has(c.newsItem.title.toLowerCase())) return false
      return true
    })

    // Also deduplicate within this batch by URL
    const seenUrls = new Set<string>()
    const uniqueCandidates = newCandidates.filter((c) => {
      if (seenUrls.has(c.newsItem.link)) return false
      seenUrls.add(c.newsItem.link)
      return true
    })

    // Limit to top 10 candidates for AI analysis
    const toAnalyze = uniqueCandidates.slice(0, 10)

    // Step 4: AI analysis for each candidate
    const results = []

    for (const candidate of toAnalyze) {
      const analysis = await analyzeNewsItem(candidate)
      if (analysis) {
        results.push(analysis)
      }
    }

    // Step 5: Rank by relevance and store
    const ranked = results.sort((a, b) => {
      const order = { High: 0, Medium: 1, Low: 2 }
      const aOrder = order[a.relevance as keyof typeof order] ?? 2
      const bOrder = order[b.relevance as keyof typeof order] ?? 2
      if (aOrder !== bOrder) return aOrder - bOrder
      return new Date(b.pub_date).getTime() - new Date(a.pub_date).getTime()
    })

    // Store all in database
    const toInsert = ranked.map((r) => ({
      company: r.company,
      headline: r.headline,
      source_url: r.source_url,
      ai_summary: r.ai_summary,
      relevance: r.relevance,
      draft_email: r.draft_email,
      contact_id: r.contact_id,
      status: 'New',
    }))

    if (toInsert.length > 0) {
      await supabase.from('daily_briefs').insert(toInsert)
    }

    // Send email digest
    const today = new Date()
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
    const top5 = ranked.slice(0, 5).map((r) => ({
      company: r.company,
      headline: r.headline,
      ai_summary: r.ai_summary,
      relevance: r.relevance,
      draft_email: r.draft_email,
      source_url: r.source_url,
    }))

    const emailResult = await sendDailyDigest(top5, upcomingFollowUps, overdueFollowUps, appUrl)

    return NextResponse.json({
      success: true,
      items: ranked.length,
      results: ranked,
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

async function analyzeNewsItem(candidate: CandidateItem) {
  const { newsItem, contact } = candidate

  // Get recent notes for context
  const recentNotes = (contact.notes || [])
    .slice(0, 3)
    .map((n) => n.summary)
    .join('; ')

  const roleGuidance = contact.role === 'Investor'
    ? `For this Investor contact, prioritize:
1. New companies raising funding that map to their portfolio thesis
2. Portfolio company news (funding, exits, M&A)
3. Regulatory changes affecting their investment areas
4. LP/fundraising market trends
5. New entrants or competitive dynamics in their sectors`
    : `For this Operator/Consultant contact, prioritize:
1. Regulatory or policy changes affecting their business
2. Competitor launches or funding in their space
3. Funding activity in their sector
4. Relevant clinical evidence or research
5. General industry trends`

  const notesContext = recentNotes
    ? `\nRecent conversation notes: ${recentNotes}`
    : ''

  const emailGuidance = recentNotes
    ? 'Reference our past conversation naturally ("Since we last spoke about..." or "This reminded me of our conversation about...")'
    : 'Keep it warm but general ("I\'ve been following [company] and thought you\'d find this interesting...")'

  const prompt = `You are a healthcare networking CRM assistant helping me maintain relationships with my professional network.

Analyze this news item for relevance to my contact:

NEWS:
- Headline: ${newsItem.title}
- Source: ${newsItem.source}
- Date: ${newsItem.pubDate}

CONTACT:
- Name: ${contact.name}
- Role: ${contact.role || 'Unknown'}
- Company: ${contact.company || 'Unknown'}
- Sector: ${contact.sector || 'Unknown'}
- Tags: ${contact.tags?.map((t) => t.tag).join(', ') || 'None'}${notesContext}

${roleGuidance}

Generate the following as JSON:
{
  "relevance": "High" or "Medium" or "Low",
  "summary": "2-3 sentences on what happened and why it matters",
  "draft_email": "A personalized outreach email"
}

EMAIL STYLE GUIDE:
- Lead with warmth and a specific callback to our last conversation if notes exist
- ${emailGuidance}
- Add value — include a brief analytical take or opinion on why this matters
- Make a soft ask — suggest coffee, a quick call, or just "would love to hear how things are going"
- Tone: professional but personal, warm, not salesy or templated
- Length: 3-5 sentences max for the news part (not counting greeting or sign-off)
- Sign off as: "Sammy"
- Include honest caveats or nuanced opinions when relevant

Return ONLY valid JSON, no other text.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0])

    return {
      company: contact.company || candidate.searchTerm,
      headline: newsItem.title,
      source_url: newsItem.link,
      ai_summary: parsed.summary,
      relevance: parsed.relevance,
      draft_email: parsed.draft_email,
      contact_id: contact.id,
      pub_date: newsItem.pubDate,
    }
  } catch (err) {
    console.error(`AI analysis failed for "${newsItem.title}":`, err)
    return null
  }
}
