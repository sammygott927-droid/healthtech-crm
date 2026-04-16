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

/**
 * Classify a watchlist company into one of the eight Type buckets:
 * Fund, Startup, Growth Stage, Incubator, Health System, Payer,
 * Consulting, Other.
 *
 * Uses one quick web search call (max 2 uses) — much cheaper than the
 * full sector inference. Returns null only if Claude refuses to commit
 * to a label (very rare given the explicit Other escape hatch).
 *
 * Persists to watchlist.type and returns the inferred value.
 */
export async function inferWatchlistType(
  watchlistId: string,
  context: WatchlistContext
): Promise<WatchlistType | null> {
  const reasonLine = context.reason ? `- Reason tracked: ${context.reason}` : ''
  const sectorLine = context.sector ? `- Current sector hint: ${context.sector}` : ''

  const prompt = `You are a healthcare networking CRM assistant. Classify the following company into exactly ONE of the eight categories below.

Company: ${context.company}
${sectorLine}
${reasonLine}

Use the web_search tool (1-2 quick searches) to confirm what the company is, then pick exactly one of:

  Fund          — VC firm, growth equity, PE, family office, accelerator fund, LP-style capital allocator. Names with Capital / Ventures / Partners / Equity / Fund are almost always Fund.
  Startup       — early-stage healthcare or healthtech company (pre-seed through Series A/B). Pre-revenue or early commercial. Building a product or service.
  Growth Stage  — later-stage operator (Series C+, post-IPO, mature private). Scaled product/service with substantial revenue. Examples: Devoted Health, Oscar, Hims, Hinge Health.
  Incubator     — accelerator program, studio, or incubator (Y Combinator, Techstars, Redesign Health, AlleyCorp, etc.). Different from a Fund — these BUILD or INCUBATE companies, not just invest.
  Health System — hospital, IDN, academic medical center, payvider, regional/national health system.
  Payer         — health insurance plan, Medicare Advantage plan, Medicaid MCO, employer health plan. (NOT payer-tech vendors — those are Startup or Growth Stage.)
  Consulting    — strategy firm, advisory, management consulting practice serving healthcare (McKinsey health, Bain healthcare, Chartis, Sg2, etc.).
  Other         — does not fit any of the above (research institution, government agency, trade association, media outlet, etc.).

OUTPUT FORMAT — STRICT:
After any web search, your FINAL message must be ONLY one of these exact strings on a single line:
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
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 2,
        },
      ],
    })
    const textBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text'
    )
    text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''
  } catch (err) {
    throw new Error(`Watchlist type inference: AI call failed (${String(err)})`)
  }

  // Take the LAST non-empty line, strip quotes/punctuation, normalize case
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''
  const cleaned = lastLine.replace(/^["'`]+|["'`.]+$/g, '').trim()

  // Try exact match first
  let matched: WatchlistType | null = TYPE_SET.has(cleaned) ? (cleaned as WatchlistType) : null

  // Fallback: case-insensitive match
  if (!matched) {
    const lowered = cleaned.toLowerCase()
    for (const t of WATCHLIST_TYPES) {
      if (t.toLowerCase() === lowered) {
        matched = t
        break
      }
    }
  }

  if (!matched) {
    return null
  }

  const { error: updateErr } = await supabase
    .from('watchlist')
    .update({ type: matched })
    .eq('id', watchlistId)

  if (updateErr) {
    throw new Error(`Failed to save watchlist type: ${updateErr.message}`)
  }

  return matched
}

/**
 * Bulk auto-infer types for a list of watchlist rows. Runs in parallel
 * batches of 3 to keep the Claude API call rate sane on large syncs.
 * Errors on individual rows are logged and skipped — callers don't
 * block on this.
 */
export async function inferWatchlistTypeForMany(
  rows: { id: string; company: string; sector?: string | null; reason?: string | null }[]
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  const BATCH = 3
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    await Promise.all(
      slice.map(async (row) => {
        try {
          const t = await inferWatchlistType(row.id, row)
          if (t) ok++
          else failed++
        } catch (err) {
          failed++
          console.error(`[infer-watchlist-type] ${row.company} failed:`, err)
        }
      })
    )
  }
  return { ok, failed }
}
