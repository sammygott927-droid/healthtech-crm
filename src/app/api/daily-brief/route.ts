import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  fetchGoogleNewsDetailed,
  fetchRssFeedDetailed,
  NewsItem,
} from '@/lib/news-fetcher'
import Anthropic from '@anthropic-ai/sdk'
import { sendDailyDigest } from '@/lib/send-digest'
import { dedupeActionsByContact } from '@/lib/dedupe-actions'
import { deduplicateArticles } from '@/lib/dedupe-articles'
import { syncContactsToWatchlist } from '@/lib/sync-contacts-to-watchlist'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'
import { filterByMaxAge } from '@/lib/article-date-filter'

// Hard cap: only articles within the last 7 days are eligible for the brief.
const MAX_ARTICLE_AGE_DAYS = 7
// Hard cap on Daily Brief size. Articles below relevance 6 never appear; if
// more than 20 score ≥ 6, keep only the top 20 by relevance_score. This is a
// MAX — if only 2 articles clear the bar, only 2 are shown.
const MAX_BRIEF_SIZE = 20
const MIN_BRIEF_RELEVANCE = 6

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/* ================================================================
   DAILY BRIEF PIPELINE v2.1 — optimized for speed
   ================================================================
   - RSS sources fetched in parallel (unchanged)
   - Google News: OR-grouped queries (5 terms per query), all parallel
   - RSS + Google News fetched simultaneously
   - Claude scoring: parallel batches of 5 articles
   - Cache: if brief already ran today, return cached results immediately
   ================================================================ */

// ── Helpers ──────────────────────────────────────────────────────

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) throw new Error('CLAUDE_API_KEY is not set')
  return new Anthropic({ apiKey: key })
}

const SOURCE_TIERS: Record<string, number> = {
  'stat news': 1, statnews: 1, techcrunch: 1, wsj: 1, 'wall street journal': 1,
  bloomberg: 1, 'modern healthcare': 1, 'fierce healthcare': 1, 'medcity news': 1,
  axios: 2, forbes: 2, 'business insider': 2, 'rock health': 2,
  'pr newswire': 3, globenewswire: 3, businesswire: 3, 'business wire': 3, finsmes: 3,
}

function getSourceTier(source: string): number {
  const lower = source.toLowerCase().trim()
  for (const [name, tier] of Object.entries(SOURCE_TIERS)) {
    if (lower.includes(name)) return tier
  }
  return 2
}

const SIGNAL_PATTERNS = [
  /\brais(?:es?|ed|ing)\b.*\$|\$.*\bmillion\b|\$.*\bbillion\b|\bfund(?:s|ed|ing|raise)\b/i,
  /\bacquir(?:e[sd]?|ing)\b|\bacquisition\b|\bmerger\b|\bmerge[sd]?\b|\bbuyout\b/i,
  /\bFDA\b|\bCMS\b|\bregulat(?:or|ory|ion|ed)\b|\bapproval\b|\bclearance\b/i,
  /\bCEO\b|\bCTO\b|\bCOO\b|\bCFO\b|\bchief\b.*\bofficer\b|\bexecutive\s+moves?\b|\bappoint(?:s|ed|ment)\b|\bhires?\b.*\b(?:VP|SVP|President|Chief)\b/i,
  /\blaunch(?:es|ed|ing)?\b|\bnew\s+company\b|\bemerges?\s+from\s+stealth\b/i,
  /\bpartnership\b|\bpartner(?:s|ed|ing)\b|\bjoint\s+venture\b|\bcollaborat(?:e|ion|ing)\b/i,
]

function computeSignalBoost(title: string): number {
  for (const pattern of SIGNAL_PATTERNS) {
    if (pattern.test(title)) return 3
  }
  return 0
}

const HEALTHCARE_BROAD = /\bhealth(?:care|tech)?\b|\bmedic(?:al|ine|aid|are)\b|\bclinic(?:al)?\b|\bpatient\b|\bpharma\b|\bbiotech\b|\bFDA\b|\bCMS\b|\bpayer\b|\bprovider\b|\binsur(?:ance|er)\b|\bhospital\b|\btherapeutic\b|\bdiagnostic\b/i

// ── Interfaces ───────────────────────────────────────────────────

type BriefCategory =
  | 'funding'
  | 'partnership'
  | 'market_news'
  | 'thought_leadership'
  | 'regulatory'

const CATEGORY_VALUES: BriefCategory[] = [
  'funding',
  'partnership',
  'market_news',
  'thought_leadership',
  'regulatory',
]

interface ScoredArticle {
  headline: string
  source_url: string
  source_name: string
  pub_date: string
  so_what: string
  relevance_tag: string
  relevance_score: number
  category: BriefCategory | null
  contact_match_score: number | null
  contact_id: string | null
  contact_match_reason: string | null
  draft_email: string | null
  signal_boost: number
}

interface ContactRecord {
  id: string
  name: string
  role: string | null
  company: string | null
  sector: string | null
  status: string | null
}

// ── Route handlers ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  return runDailyBrief(request)
}

export async function POST(request: NextRequest) {
  return runDailyBrief(request)
}

// ── Main pipeline ────────────────────────────────────────────────

async function runDailyBrief(request: NextRequest) {
  const pipelineStart = Date.now()
  try {
    console.log('[brief] Pipeline starting…')

    // ═══ CACHE CHECK: if brief already ran today, return cached results ═══
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

    const { data: todayRows, error: cacheErr } = await supabase
      .from('daily_briefs')
      .select('id')
      .gte('created_at', startOfDay)
      .limit(1)

    if (!cacheErr && todayRows && todayRows.length > 0) {
      console.log(`[brief] Brief already ran today — returning cached results`)
      return NextResponse.json({
        success: true,
        cached: true,
        message: 'Brief already ran today. Results are cached in /api/briefs-today.',
        elapsed_seconds: 0,
      })
    }

    // ═══ STEP 0: Auto-sync contacts → watchlist (Task 9 item 19) ═══
    // Any non-Dormant contact.company that isn't on the watchlist yet gets
    // added as auto_added=true before we build the universe. Type inference
    // for new rows runs sequentially up to a short time budget; if it
    // doesn't finish, the Re-infer UI button can catch up later.
    const t0 = Date.now()
    try {
      const newlySynced = await syncContactsToWatchlist()
      if (newlySynced.length > 0) {
        console.log(
          `[brief] Auto-sync added ${newlySynced.length} new watchlist rows from contacts`
        )
        // Fire type inference but don't let it blow the pipeline budget —
        // cap at 15s total.
        await Promise.race([
          inferWatchlistTypeForMany(newlySynced),
          new Promise((resolve) => setTimeout(resolve, 15_000)),
        ])
      }
    } catch (err) {
      console.error('[brief] Auto-sync failed (continuing with pipeline):', err)
    }
    console.log(`[brief] Step 0 (auto-sync) done in ${Date.now() - t0}ms`)

    // ═══ STEP 1: Build the universe ═══
    const [
      { data: contacts },
      { data: watchlist },
      { data: tagRows },
      { data: savedSources },
    ] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, name, role, company, sector, status')
        .neq('status', 'Dormant'),
      supabase.from('watchlist').select('company, sector'),
      supabase.from('tags').select('tag'),
      supabase.from('news_sources').select('name, url'),
    ])

    const contactList: ContactRecord[] = (contacts || []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      role: c.role as string | null,
      company: c.company as string | null,
      sector: c.sector as string | null,
      status: c.status as string | null,
    }))

    // Company terms get searched via Google News; all terms used for pre-filter
    const companyTerms: string[] = []
    const allTerms = new Set<string>()

    for (const c of contactList) {
      if (c.company) {
        const key = c.company.toLowerCase().trim()
        if (!allTerms.has(key)) {
          allTerms.add(key)
          companyTerms.push(c.company.trim()) // keep original case for queries
        }
      }
      if (c.sector) {
        const key = c.sector.toLowerCase().trim()
        if (key.length >= 3) allTerms.add(key)
      }
    }
    for (const w of watchlist || []) {
      const company = (w.company as string | null)?.trim()
      if (company) {
        const key = company.toLowerCase()
        if (!allTerms.has(key)) {
          allTerms.add(key)
          companyTerms.push(company)
        }
      }
    }
    for (const t of tagRows || []) {
      const tag = (t.tag as string | null)?.trim()
      if (tag && tag.length >= 3) allTerms.add(tag.toLowerCase())
    }

    // Build OR-grouped Google News queries (5 companies per query)
    const OR_GROUP_SIZE = 5
    const googleQueries: string[] = []
    for (let i = 0; i < companyTerms.length; i += OR_GROUP_SIZE) {
      const group = companyTerms.slice(i, i + OR_GROUP_SIZE)
      // Quote multi-word names, join with OR
      const query = group
        .map((t) => (t.includes(' ') ? `"${t}"` : t))
        .join(' OR ')
      googleQueries.push(query)
    }

    console.log(`[brief] Universe: ${allTerms.size} total terms, ${companyTerms.length} companies → ${googleQueries.length} OR-grouped Google queries`)

    // ═══ STEP 2: Fetch ALL sources in parallel ═══
    const t2 = Date.now()

    // Launch each RSS source + each Google News query individually so we can
    // report per-source fetch health ("Rock Health: 0 fetched (HTTP 403)").
    const sourcesList = (savedSources || []).map((s) => ({
      name: s.name as string,
      url: s.url as string,
    }))

    const rssFetchPromises = sourcesList.map((s) =>
      fetchRssFeedDetailed(s.url, s.name, 10).then((res) => ({ name: s.name, ...res }))
    )
    const googleFetchPromises = googleQueries.map((q) =>
      fetchGoogleNewsDetailed(q, 10).then((res) => ({ query: q, ...res }))
    )

    console.log(
      `[brief] Fetching ${sourcesList.length} RSS sources + ${googleQueries.length} Google queries in parallel…`
    )

    const [rssResults, googleResults] = await Promise.all([
      Promise.all(rssFetchPromises),
      Promise.all(googleFetchPromises),
    ])

    console.log(`[brief] Fetch done in ${Date.now() - t2}ms`)

    // ═══ FRESHNESS FILTER (max 7 days) + per-source stats ═══
    // Applied PER-SOURCE for RSS (so the debug UI can show each feed
    // individually) and aggregated across all queries for Google News
    // (since individual queries are just OR-groups of companies, not
    // distinct sources from the user's perspective).
    const perSourceStats: {
      source: string
      fetched: number
      passed: number
      error: string | null
    }[] = []

    const rssItems: NewsItem[] = []
    for (const r of rssResults) {
      const filtered = filterByMaxAge(r.items, MAX_ARTICLE_AGE_DAYS)
      rssItems.push(...filtered.kept)
      perSourceStats.push({
        source: r.name,
        fetched: r.items.length,
        passed: filtered.kept.length,
        error: r.error,
      })
    }

    const googleAllRaw: NewsItem[] = []
    let googleErrorCount = 0
    for (const g of googleResults) {
      googleAllRaw.push(...g.items)
      if (g.error) googleErrorCount++
    }
    const googleFiltered = filterByMaxAge(googleAllRaw, MAX_ARTICLE_AGE_DAYS)
    const googleItems = googleFiltered.kept
    perSourceStats.push({
      source: 'Google News',
      fetched: googleAllRaw.length,
      passed: googleItems.length,
      error:
        googleErrorCount > 0
          ? `${googleErrorCount} of ${googleResults.length} queries failed`
          : null,
    })

    console.log(
      `[brief] Freshness filter (>${MAX_ARTICLE_AGE_DAYS}d cutoff=${googleFiltered.cutoff_iso}):`
    )
    for (const s of perSourceStats) {
      console.log(
        `  ${s.source}: ${s.fetched} fetched, ${s.passed} passed${s.error ? ` (${s.error})` : ''}`
      )
    }

    const allRaw = [...rssItems, ...googleItems]

    // Deduplicate. Two-stage with proper-noun anchoring + merge-until-stable
    // (see src/lib/dedupe-articles.ts for the reasoning behind each rule).
    const dedupResult = deduplicateArticles(allRaw, getSourceTier)
    const deduped = dedupResult.articles
    console.log(
      `[brief] After dedup: ${deduped.length} unique (from ${dedupResult.raw_count} raw, ${dedupResult.merges} merges)`
    )

    // ═══ STEP 3: Pre-filter ═══
    const preFiltered: (NewsItem & { signal_boost: number })[] = []
    const universeLower = Array.from(allTerms)

    for (const article of deduped) {
      const titleLower = article.title.toLowerCase()
      const boost = computeSignalBoost(article.title)

      const mentionsUniverse = universeLower.some(
        (term) => term.length >= 3 && titleLower.includes(term)
      )
      const isBroadlyHealthcare = HEALTHCARE_BROAD.test(article.title)

      if (!mentionsUniverse && !isBroadlyHealthcare) continue

      preFiltered.push({ ...article, signal_boost: boost })
    }

    console.log(`[brief] After pre-filter: ${preFiltered.length}`)

    if (preFiltered.length === 0) {
      return NextResponse.json({ success: true, brief_count: 0, action_count: 0, message: 'No articles passed pre-filtering' })
    }

    // ═══ STEP 4: Skip articles already stored today ═══
    // Run today's stored headlines through the SAME dedup function as the
    // in-memory pass, so a re-run of the pipeline can't reintroduce a
    // re-worded version of the same story (e.g. "FDA approves Dupixent…"
    // already stored, then later we see "Sanofi's Dupixent gets pediatric
    // nod" from a different feed).
    const { data: todayHeadlines } = await supabase
      .from('daily_briefs')
      .select('headline, source_name')
      .gte('created_at', startOfDay)

    // Mark stored items with a sentinel source so we can tell them apart
    // from fresh candidates in the combined dedup pass below. The sentinel
    // is also force-tier-0 (best), so on a merge the stored item wins as
    // representative and the candidate is dropped.
    const STORED_SENTINEL = '__already_stored__'

    const storedAsItems: NewsItem[] = (todayHeadlines || []).map((r) => ({
      title: r.headline as string,
      link: '',
      pubDate: '',
      source: STORED_SENTINEL,
    }))

    const candidatesAsItems: NewsItem[] = preFiltered.map((a) => ({
      title: a.title,
      link: a.link,
      pubDate: a.pubDate,
      source: a.source,
    }))

    const combined = [...storedAsItems, ...candidatesAsItems]
    const tierForCombined = (src: string) =>
      src === STORED_SENTINEL ? 0 : getSourceTier(src)
    const combinedDedup = deduplicateArticles(combined, tierForCombined)

    // After dedup: any group whose representative source is the sentinel
    // belongs to a story already in the DB → drop it. Any group whose
    // representative source is NOT the sentinel is a fresh candidate.
    const freshCandidateTitles = new Set(
      combinedDedup.articles
        .filter((a) => a.source !== STORED_SENTINEL)
        .map((a) => a.title)
    )

    const newArticles = preFiltered.filter((a) => freshCandidateTitles.has(a.title))

    const dupedAgainstStored = preFiltered.length - newArticles.length
    if (dupedAgainstStored > 0) {
      console.log(
        `[brief] Skipped ${dupedAgainstStored} candidates that match stories already stored today`
      )
    }

    if (newArticles.length === 0) {
      return NextResponse.json({
        success: true,
        brief_count: 0,
        action_count: 0,
        message: 'All articles already processed today',
      })
    }

    console.log(`[brief] New articles to score: ${newArticles.length}`)

    // ═══ STEP 5: Claude scoring — parallel batches of 5 ═══
    const t5 = Date.now()
    const contactSummaries = contactList.map(
      (c) => `- ${c.name} (${c.role || '?'}) at ${c.company || '?'} [${c.status || '?'}] — sector: ${c.sector || '?'}`
    )

    const scored = await scoreArticlesParallel(newArticles, contactSummaries, contactList)

    console.log(`[brief] Claude scoring done: ${scored.length} articles in ${Date.now() - t5}ms`)

    // ═══ STEP 6: Store all scored articles ═══
    if (scored.length > 0) {
      const rows = scored.map((a) => ({
        headline: a.headline,
        source_url: a.source_url,
        source_name: a.source_name,
        pub_date: a.pub_date,
        so_what: a.so_what,
        relevance_tag: a.relevance_tag,
        relevance_score: a.relevance_score,
        category: a.category,
        contact_match_score: a.contact_match_score,
        contact_id: a.contact_id,
        contact_match_reason: a.contact_match_reason,
        draft_email: a.draft_email,
        signal_boost: a.signal_boost,
        status: 'New',
      }))

      const { error: insertErr } = await supabase.from('daily_briefs').insert(rows)
      if (insertErr) {
        console.error('[brief] Insert error:', insertErr.message)
      }
    }

    // ═══ STEP 7: Send email digest ═══
    // Apply the same brief filter used by the Daily Brief tab: relevance ≥ 6,
    // sorted desc, capped at MAX_BRIEF_SIZE. 20 is a MAX — if fewer clear the
    // bar, fewer are sent. Never padded with low-quality filler.
    const briefItems = scored
      .filter((a) => a.relevance_score >= MIN_BRIEF_RELEVANCE)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, MAX_BRIEF_SIZE)

    const actionItems = buildActionItems(scored, contactList)

    const contactById = new Map(contactList.map((c) => [c.id, c]))
    const emailActions = actionItems.map((a) => {
      const c = a.contact_id ? contactById.get(a.contact_id) : null
      return {
        ...a,
        contact_name: c?.name,
        contact_company: c?.company ?? undefined,
      }
    })

    const appUrl = new URL('/', request.url).toString()
    const emailResult = await sendDailyDigest(briefItems, emailActions, appUrl)

    const elapsed = Math.round((Date.now() - pipelineStart) / 1000)
    console.log(`[brief] Pipeline complete in ${elapsed}s — ${briefItems.length} brief, ${actionItems.length} actions, ${scored.length} scored`)

    // ═══ STEP 8: Persist per-source stats for the UI's "Show source debug" link ═══
    const statsPayload = {
      per_source: perSourceStats,
      cutoff_iso: googleFiltered.cutoff_iso,
      total_scored: scored.length,
      brief_count: briefItems.length,
      action_count: actionItems.length,
      elapsed_seconds: elapsed,
    }
    const { error: statsErr } = await supabase
      .from('brief_run_stats')
      .insert({ stats: statsPayload })
    if (statsErr) {
      console.error('[brief] Failed to persist run stats:', statsErr.message)
    }

    return NextResponse.json({
      success: true,
      brief_count: briefItems.length,
      action_count: actionItems.length,
      total_scored: scored.length,
      elapsed_seconds: elapsed,
      email: emailResult,
      source_debug: statsPayload,
    })
  } catch (err) {
    console.error('Daily brief failed:', err)
    return NextResponse.json(
      { error: 'Daily brief failed', details: String(err) },
      { status: 500 }
    )
  }
}

// ── Build top 5 action items ─────────────────────────────────────
//
// Two-step pipeline (Task 7):
//   1. Dedupe by contact_id — each contact appears at most once. If
//      multiple scored articles match the same contact at score >= 7,
//      keep the single highest-ranked one.
//   2. Apply top-5 cap + Cold rule (max 1 Cold, only if match >= 9).

function buildActionItems(scored: ScoredArticle[], contacts: ContactRecord[]): ScoredArticle[] {
  const contactMap = new Map<string, ContactRecord>()
  for (const c of contacts) contactMap.set(c.id, c)

  const withMatch = scored.filter(
    (a) => a.contact_match_score !== null && a.contact_match_score >= 7 && a.contact_id
  )

  const dedupedCandidates = dedupeActionsByContact(
    withMatch.map((a) => {
      const contact = a.contact_id ? contactMap.get(a.contact_id) : null
      return {
        item: a,
        contact_id: a.contact_id as string,
        relevance_score: a.relevance_score,
        contact_match_score: a.contact_match_score ?? 0,
        status: contact?.status ?? null,
      }
    })
  )

  const result: ScoredArticle[] = []
  let coldCount = 0

  for (const candidate of dedupedCandidates) {
    if (result.length >= 5) break
    const article = candidate.item
    if (candidate.status === 'Cold') {
      if (coldCount >= 1) continue
      if ((article.contact_match_score ?? 0) < 9) continue
      coldCount++
    }
    result.push(article)
  }

  return result
}

// ── Claude scoring — parallel batches of 5 articles ──────────────

async function scoreArticlesParallel(
  articles: (NewsItem & { signal_boost: number })[],
  contactSummaries: string[],
  contacts: ContactRecord[]
): Promise<ScoredArticle[]> {
  const contactBlock = contactSummaries.length > 0
    ? contactSummaries.join('\n')
    : '(no contacts in CRM)'

  // Split into batches of 5
  const BATCH_SIZE = 5
  const batches: (NewsItem & { signal_boost: number })[][] = []
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE))
  }

  console.log(`[brief] Scoring ${articles.length} articles in ${batches.length} parallel batches of ≤${BATCH_SIZE}…`)

  // Fire ALL batches in parallel
  const t = Date.now()
  const batchResults = await Promise.all(
    batches.map((batch, idx) => {
      console.log(`[brief] Claude batch ${idx + 1}/${batches.length} (${batch.length} articles) → launching`)
      return scoreBatch(batch, contactBlock, contacts).then((results) => {
        console.log(`[brief] Claude batch ${idx + 1} done in ${Date.now() - t}ms → ${results.length} scored`)
        return results
      })
    })
  )

  return batchResults.flat()
}

async function scoreBatch(
  articles: (NewsItem & { signal_boost: number })[],
  contactBlock: string,
  contacts: ContactRecord[]
): Promise<ScoredArticle[]> {
  const articlesList = articles
    .map(
      (a, i) =>
        `[${i}] "${a.title}"\n    Source: ${a.source} | Date: ${a.pubDate}\n    URL: ${a.link}`
    )
    .join('\n\n')

  const prompt = `You are a healthcare networking CRM assistant. Score each article below on two dimensions.

═══ ARTICLES ═══
${articlesList}

═══ MY CONTACTS (Active/Warm/Cold) ═══
${contactBlock}

═══ SCORING INSTRUCTIONS ═══

For EACH article, produce:

1. relevance_score (1-10): How interesting and noteworthy for someone tracking healthcare investing and innovation? Medium bar:
   - 8-10: Major funding rounds ($50M+), significant M&A, major regulatory decisions, market-moving news
   - 6-7: Notable funding rounds, meaningful partnerships, executive moves at known companies, strong thought leadership
   - 4-5: Minor news, incremental updates, niche developments
   - 1-3: Generic press releases, marketing fluff, barely healthcare-related

2. contact_match_score (1-10 or null): Does this give a natural "I saw this and thought of you" reason to reach out to a specific Active, Warm, or (very rarely) Cold contact?
   - 9-10: Their company is directly mentioned, or it's about their exact area of focus
   - 7-8: Closely adjacent to their work — a competitor, a company in their portfolio, their clinical domain
   - 4-6: Loosely related to their sector
   - null: No meaningful contact match

3. so_what (string): 1-2 sentences — why this matters for someone in healthcare investing/innovation. Be specific, not generic.

4. relevance_tag (string): Why this article surfaced. Format examples:
   - "Matches tag: value-based care"
   - "Watchlist: SimpliFed"
   - "Relevant to: Tara Sullivan — Flare Capital"
   - "Sector: maternal health tech"
   - "Industry news: FDA regulatory"

5. category (string): Classify into EXACTLY ONE of these five buckets:
   - "funding"             — funding rounds, fundraises, VC announcements
   - "partnership"         — partnerships, collaborations, payer/provider deals,
                             joint ventures, distribution agreements
   - "regulatory"          — FDA / CMS / policy / regulation, approvals,
                             clearances, guidance, lawsuits, settlements
   - "thought_leadership"  — analysis, opinion, research reports,
                             long-form pieces, interviews, data releases
                             (think STAT features, a16z essays, Stratechery)
   - "market_news"         — everything else: exec moves, M&A, product
                             launches, trends, stealth-company news.
                             Default bucket when the story doesn't cleanly
                             fit one of the four above.

6. IF contact_match_score >= 7:
   - contact_name: the matched contact's full name (MUST match a name from the contacts list exactly)
   - contact_match_reason: one sentence — why this is relevant to them specifically
   - draft_email: A complete outreach email anchored on this specific news hook. Format:
     Warm opener → one substance sentence about the article and why you thought of them →
     soft ask (coffee/call/catching up) → signed Sammy.
     Tone: professional but personal, warm, not salesy.
     NEVER write a generic check-in — always anchor on the news.

═══ OUTPUT FORMAT ═══
Return a JSON array with one object per article, indexed by position:
[
  {
    "index": 0,
    "relevance_score": 7,
    "contact_match_score": 8,
    "so_what": "...",
    "relevance_tag": "...",
    "category": "funding",
    "contact_name": "Jane Doe",
    "contact_match_reason": "...",
    "draft_email": "..."
  },
  {
    "index": 1,
    "relevance_score": 4,
    "contact_match_score": null,
    "so_what": "...",
    "relevance_tag": "...",
    "category": "market_news",
    "contact_name": null,
    "contact_match_reason": null,
    "draft_email": null
  }
]

Return ONLY valid JSON, no other text.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const first = text.indexOf('[')
    const last = text.lastIndexOf(']')
    if (first === -1 || last === -1 || last <= first) {
      console.error('[brief] Claude returned no parseable JSON array')
      return []
    }

    const parsed = JSON.parse(text.slice(first, last + 1))
    if (!Array.isArray(parsed)) return []

    const nameToContact = new Map<string, ContactRecord>()
    for (const c of contacts) {
      nameToContact.set(c.name.toLowerCase().trim(), c)
    }

    const results: ScoredArticle[] = []
    for (const item of parsed) {
      const idx = typeof item.index === 'number' ? item.index : null
      if (idx === null || idx < 0 || idx >= articles.length) continue

      const article = articles[idx]
      const relScore = Math.min(10, Math.max(1, Math.round(Number(item.relevance_score) || 1)))
      const matchScore =
        item.contact_match_score !== null && item.contact_match_score !== undefined
          ? Math.min(10, Math.max(1, Math.round(Number(item.contact_match_score))))
          : null

      let contactId: string | null = null
      if (matchScore !== null && matchScore >= 7 && typeof item.contact_name === 'string') {
        const matched = nameToContact.get(item.contact_name.toLowerCase().trim())
        if (matched) contactId = matched.id
      }

      // Category — accept only the 5 whitelisted values, null otherwise.
      const rawCategory = typeof item.category === 'string' ? item.category.trim().toLowerCase() : ''
      const category: BriefCategory | null =
        CATEGORY_VALUES.includes(rawCategory as BriefCategory)
          ? (rawCategory as BriefCategory)
          : null

      results.push({
        headline: article.title,
        source_url: article.link,
        source_name: article.source,
        pub_date: article.pubDate,
        so_what: typeof item.so_what === 'string' ? item.so_what : '',
        relevance_tag: typeof item.relevance_tag === 'string' ? item.relevance_tag : '',
        relevance_score: relScore,
        category,
        contact_match_score: matchScore,
        contact_id: contactId,
        contact_match_reason: typeof item.contact_match_reason === 'string' ? item.contact_match_reason : null,
        draft_email: typeof item.draft_email === 'string' ? item.draft_email : null,
        signal_boost: article.signal_boost,
      })
    }

    return results
  } catch (err) {
    console.error('[brief] Claude scoring failed:', err)
    return []
  }
}
