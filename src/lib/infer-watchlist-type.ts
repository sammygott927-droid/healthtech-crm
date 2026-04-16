import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
}

export const WATCHLIST_TYPES = [
  'Fund',
  'Startup',
  'Growth Stage',
  'Incubator',
  'Health System',
  'Payer',
  'Consulting',
  'Other',
] as const

export type WatchlistType = (typeof WATCHLIST_TYPES)[number]

const TYPE_SET = new Set<string>(WATCHLIST_TYPES)

interface WatchlistContext {
  company: string
  sector?: string | null
  reason?: string | null
}

const TYPE_DEFINITIONS = `Type definitions:
  Fund          — VC firm, growth equity, PE, family office, accelerator fund, LP-style capital allocator. Names with Capital / Ventures / Partners / Equity / Fund are almost always Fund.
  Startup       — early-stage healthcare or healthtech company (pre-seed through Series A/B). Pre-revenue or early commercial. Building a product or service.
  Growth Stage  — later-stage operator (Series C+, post-IPO, mature private). Scaled product/service with substantial revenue. Examples: Devoted Health, Oscar, Hims, Hinge Health.
  Incubator     — accelerator program, studio, or incubator (Y Combinator, Techstars, Redesign Health, AlleyCorp, etc.). Different from a Fund — these BUILD or INCUBATE companies, not just invest.
  Health System — hospital, IDN, academic medical center, payvider, regional/national health system.
  Payer         — health insurance plan, Medicare Advantage plan, Medicaid MCO, employer health plan. (NOT payer-tech vendors — those are Startup or Growth Stage.)
  Consulting    — strategy firm, advisory, management consulting practice serving healthcare (McKinsey health, Bain healthcare, Chartis, Sg2, etc.).
  Other         — does not fit any of the above (research institution, government agency, trade association, media outlet, etc.).`

// ────────────────────────────────────────────────────────────────────
// Tier 1: contextual classification (no web search)
//
// Cheap and instant. Asks Claude to classify based on name + sector +
// reason alone, with a confidence score so we know when to escalate.
// ────────────────────────────────────────────────────────────────────

interface ContextualResult {
  type: WatchlistType
  confidence: number
}

async function classifyTypeFromContext(
  context: WatchlistContext
): Promise<ContextualResult | null> {
  const sectorLine = context.sector ? `- Sector hint: ${context.sector}` : ''
  const reasonLine = context.reason ? `- Reason tracked: ${context.reason}` : ''

  const prompt = `Classify the following healthcare company into one of the eight types below using ONLY the information provided. Do not search the web. If the company name and sector strongly indicate a category, give high confidence. If you'd need to look it up to be sure, give low confidence.

Company: ${context.company}
${sectorLine}
${reasonLine}

${TYPE_DEFINITIONS}

OUTPUT FORMAT — STRICT:
Return ONLY a single JSON object on one line, no other text:
{"type": "Fund", "confidence": 0.95}

confidence is a number between 0 and 1. Use ≥ 0.7 only when you are confident from name/sector signals alone (e.g. "Flare Capital" obviously has Capital → Fund; "Aetna" is a famous Payer; "McKinsey Health" → Consulting). Use < 0.7 when the name is ambiguous and you'd really need to look up what the company does. type must be exactly one of: Fund, Startup, Growth Stage, Incubator, Health System, Payer, Consulting, Other.`

  let text: string
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    text = response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (err) {
    console.error(`[infer-type tier1] AI call failed for ${context.company}:`, err)
    return null
  }

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null
  }

  let parsed: { type?: unknown; confidence?: unknown }
  try {
    parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }

  const rawType = typeof parsed.type === 'string' ? parsed.type.trim() : ''
  const matched = matchType(rawType)
  if (!matched) return null

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
  return { type: matched, confidence }
}

// ────────────────────────────────────────────────────────────────────
// Tier 2: web search classification (with 10s hard timeout)
//
// Only invoked when tier 1 confidence is low or returned 'Other'.
// Uses one quick web search then picks a type. Times out cleanly so
// bulk operations don't blow the Vercel function budget.
// ────────────────────────────────────────────────────────────────────

const WEB_SEARCH_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function classifyTypeWithWebSearch(
  context: WatchlistContext
): Promise<WatchlistType | null> {
  const sectorLine = context.sector ? `- Sector hint: ${context.sector}` : ''
  const reasonLine = context.reason ? `- Reason tracked: ${context.reason}` : ''

  const prompt = `Classify the following healthcare company into exactly ONE of the eight types below.

Company: ${context.company}
${sectorLine}
${reasonLine}

Use the web_search tool ONCE (one quick search) to confirm what the company is, then commit to a type.

${TYPE_DEFINITIONS}

OUTPUT FORMAT — STRICT:
After the search, your FINAL message must be ONLY one of these exact strings on a single line:
  Fund
  Startup
  Growth Stage
  Incubator
  Health System
  Payer
  Consulting
  Other

No JSON, no quotes, no explanation, no preamble.`

  let text: string
  try {
    const apiCall = getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 1,
        },
      ],
    })

    const response = await withTimeout(
      apiCall,
      WEB_SEARCH_TIMEOUT_MS,
      `Web search for ${context.company}`
    )

    const textBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text'
    )
    text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''
  } catch (err) {
    console.warn(
      `[infer-type tier2] Web search failed/timed out for ${context.company}:`,
      String(err).slice(0, 200)
    )
    return null
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''
  const cleaned = lastLine.replace(/^["'`]+|["'`.]+$/g, '').trim()
  return matchType(cleaned)
}

function matchType(raw: string): WatchlistType | null {
  if (!raw) return null
  if (TYPE_SET.has(raw)) return raw as WatchlistType
  const lowered = raw.toLowerCase()
  for (const t of WATCHLIST_TYPES) {
    if (t.toLowerCase() === lowered) return t
  }
  return null
}

// ────────────────────────────────────────────────────────────────────
// Public entrypoint
//
// Tiered strategy:
//   1. Tier 1 (no web search) — if confidence >= 0.7 AND type !== 'Other',
//      use it.
//   2. Tier 2 (web search, 10s timeout) — only when tier 1 was uncertain
//      or returned 'Other'.
//   3. Default to 'Other' if everything failed.
//
// Always persists a value (never null), so the row's "Inferring…" badge
// resolves on the very next page load even when both tiers fail.
// ────────────────────────────────────────────────────────────────────

export async function inferWatchlistType(
  watchlistId: string,
  context: WatchlistContext
): Promise<WatchlistType> {
  // Tier 1
  let chosen: WatchlistType | null = null
  let source = 'default'

  const tier1 = await classifyTypeFromContext(context)
  if (tier1 && tier1.confidence >= 0.7 && tier1.type !== 'Other') {
    chosen = tier1.type
    source = 'context'
    console.log(
      `[infer-type] ${context.company} → ${chosen} (tier 1, conf ${tier1.confidence})`
    )
  } else {
    // Tier 2 — escalate to web search (with timeout)
    const tier2 = await classifyTypeWithWebSearch(context)
    if (tier2) {
      chosen = tier2
      source = 'web_search'
      console.log(`[infer-type] ${context.company} → ${chosen} (tier 2, web search)`)
    } else if (tier1) {
      // Web search failed, but tier 1 gave us something — use it even at low conf
      chosen = tier1.type
      source = 'context_fallback'
      console.log(
        `[infer-type] ${context.company} → ${chosen} (tier 1 fallback, conf ${tier1.confidence})`
      )
    }
  }

  const finalType: WatchlistType = chosen ?? 'Other'
  if (!chosen) {
    console.log(`[infer-type] ${context.company} → Other (default — both tiers failed)`)
  }

  // Persist immediately so the badge resolves on next page load and we
  // never re-infer the same row on subsequent visits.
  const { error: updateErr } = await supabase
    .from('watchlist')
    .update({ type: finalType })
    .eq('id', watchlistId)

  if (updateErr) {
    throw new Error(`Failed to save watchlist type: ${updateErr.message}`)
  }

  console.log(`[infer-type] saved ${context.company} = ${finalType} (source=${source})`)
  return finalType
}

// ────────────────────────────────────────────────────────────────────
// Bulk: parallel batches of 5 (tier 1 alone is fast, so we can run more
// at once). Runs entirely fire-and-forget for callers — errors are
// swallowed and logged, never bubble up.
// ────────────────────────────────────────────────────────────────────

export async function inferWatchlistTypeForMany(
  rows: { id: string; company: string; sector?: string | null; reason?: string | null }[]
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  const BATCH = 5
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    await Promise.all(
      slice.map(async (row) => {
        try {
          await inferWatchlistType(row.id, row)
          ok++
        } catch (err) {
          failed++
          console.error(`[infer-watchlist-type] ${row.company} failed:`, err)
        }
      })
    )
  }
  return { ok, failed }
}
