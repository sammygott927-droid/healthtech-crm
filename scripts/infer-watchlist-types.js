#!/usr/bin/env node
/**
 * Standalone Type inference script for the WATCHLIST table (Task 5b).
 *
 * Mirrors the tiered classifier in src/lib/infer-watchlist-type.ts:
 *   Tier 1 — Claude classifies from name + sector + reason alone (no
 *            web search). Returns {type, confidence}. Used when
 *            confidence ≥ 0.7 AND type !== 'Other'.
 *   Tier 2 — Web search (max 1 use, wrapped in 10s hard timeout) when
 *            tier 1 was uncertain or returned 'Other'.
 *   Tier 3 — Default to 'Other' if both tiers fail. Always saves a
 *            value so the row never re-runs on subsequent script
 *            invocations (idempotent).
 *
 * USAGE (from project root):
 *   node --env-file=.env.local scripts/infer-watchlist-types.js
 *
 * Optional flags:
 *   --force         Re-process ALL watchlist rows, including ones that
 *                   already have a type set
 *   --dry-run       Print what would change without writing to Supabase
 *   --limit=N       Stop after N rows (useful for testing)
 */

const Anthropic = require('@anthropic-ai/sdk').default
const { createClient } = require('@supabase/supabase-js')

// ---------- Config ----------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ANTHROPIC_KEY = process.env.CLAUDE_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.error('Missing CLAUDE_API_KEY in .env.local')
  process.exit(1)
}

// Defense against Claude Code / shell env collision: the SDK falls back to
// process.env.ANTHROPIC_API_KEY, so if the shell has one set to a different
// account, strip it.
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== ANTHROPIC_KEY) {
  console.log(
    'Note: stripping ANTHROPIC_API_KEY from env (likely set by Claude Code) — using CLAUDE_API_KEY from .env.local instead.'
  )
  delete process.env.ANTHROPIC_API_KEY
}

const keyPrefix = ANTHROPIC_KEY.slice(0, 12)
const keySuffix = ANTHROPIC_KEY.slice(-4)
console.log(`Using Anthropic key: ${keyPrefix}...${keySuffix} (from CLAUDE_API_KEY)`)

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const DRY_RUN = args.includes('--dry-run')
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='))
  return a ? parseInt(a.split('=')[1], 10) || null : null
})()

const WATCHLIST_TYPES = [
  'Fund',
  'Startup',
  'Growth Stage',
  'Incubator',
  'Health System',
  'Payer',
  'Consulting',
  'Other',
]
const TYPE_SET = new Set(WATCHLIST_TYPES)

const TYPE_DEFINITIONS = `Type definitions:
  Fund          — VC firm, growth equity, PE, family office, accelerator fund, LP-style capital allocator. Names with Capital / Ventures / Partners / Equity / Fund are almost always Fund.
  Startup       — early-stage healthcare or healthtech company (pre-seed through Series A/B). Pre-revenue or early commercial. Building a product or service.
  Growth Stage  — later-stage operator (Series C+, post-IPO, mature private). Scaled product/service with substantial revenue. Examples: Devoted Health, Oscar, Hims, Hinge Health.
  Incubator     — accelerator program, studio, or incubator (Y Combinator, Techstars, Redesign Health, AlleyCorp, etc.). Different from a Fund — these BUILD or INCUBATE companies, not just invest.
  Health System — hospital, IDN, academic medical center, payvider, regional/national health system.
  Payer         — health insurance plan, Medicare Advantage plan, Medicaid MCO, employer health plan. (NOT payer-tech vendors — those are Startup or Growth Stage.)
  Consulting    — strategy firm, advisory, management consulting practice serving healthcare (McKinsey health, Bain healthcare, Chartis, Sg2, etc.).
  Other         — does not fit any of the above (research institution, government agency, trade association, media outlet, etc.).`

// ---------- Clients ----------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })

// ---------- Helpers ----------

function withTimeout(promise, ms, label) {
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

function matchType(raw) {
  if (!raw) return null
  if (TYPE_SET.has(raw)) return raw
  const lowered = raw.toLowerCase()
  for (const t of WATCHLIST_TYPES) {
    if (t.toLowerCase() === lowered) return t
  }
  return null
}

// ---------- Tier 1: classify from context (no web search) ----------

async function classifyFromContext(row) {
  const sectorLine = row.sector ? `- Sector hint: ${row.sector}` : ''
  const reasonLine = row.reason ? `- Reason tracked: ${row.reason}` : ''

  const prompt = `Classify the following healthcare company into one of the eight types below using ONLY the information provided. Do not search the web. If the company name and sector strongly indicate a category, give high confidence. If you'd need to look it up to be sure, give low confidence.

Company: ${row.company}
${sectorLine}
${reasonLine}

${TYPE_DEFINITIONS}

OUTPUT FORMAT — STRICT:
Return ONLY a single JSON object on one line, no other text:
{"type": "Fund", "confidence": 0.95}

confidence is a number between 0 and 1. Use ≥ 0.7 only when you are confident from name/sector signals alone (e.g. "Flare Capital" obviously has Capital → Fund; "Aetna" is a famous Payer; "McKinsey Health" → Consulting). Use < 0.7 when the name is ambiguous and you'd really need to look up what the company does. type must be exactly one of: Fund, Startup, Growth Stage, Incubator, Health System, Payer, Consulting, Other.`

  let text
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    text = r.content[0].type === 'text' ? r.content[0].text : ''
  } catch (err) {
    console.error(`  tier 1 AI error for ${row.company}:`, err.message || err)
    return null
  }

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null

  let parsed
  try {
    parsed = JSON.parse(text.slice(first, last + 1))
  } catch {
    return null
  }

  const type = matchType(typeof parsed.type === 'string' ? parsed.type.trim() : '')
  if (!type) return null

  return {
    type,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  }
}

// ---------- Tier 2: web search (with 10s timeout) ----------

const WEB_SEARCH_TIMEOUT_MS = 10_000

async function classifyWithWebSearch(row) {
  const sectorLine = row.sector ? `- Sector hint: ${row.sector}` : ''
  const reasonLine = row.reason ? `- Reason tracked: ${row.reason}` : ''

  const prompt = `Classify the following healthcare company into exactly ONE of the eight types below.

Company: ${row.company}
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

  let text
  try {
    const apiCall = anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 1 },
      ],
    })

    const r = await withTimeout(apiCall, WEB_SEARCH_TIMEOUT_MS, `Web search for ${row.company}`)

    const blocks = r.content.filter((b) => b.type === 'text')
    text = blocks.length > 0 ? blocks[blocks.length - 1].text : ''
  } catch (err) {
    console.warn(`  tier 2 web search failed/timed out for ${row.company}: ${err.message || err}`)
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

// ---------- Combined tiered inference ----------

async function inferType(row) {
  const tier1 = await classifyFromContext(row)
  if (tier1 && tier1.confidence >= 0.7 && tier1.type !== 'Other') {
    return { type: tier1.type, source: `tier1 (conf ${tier1.confidence})` }
  }

  const tier2 = await classifyWithWebSearch(row)
  if (tier2) {
    return { type: tier2, source: 'tier2 (web search)' }
  }

  if (tier1) {
    return {
      type: tier1.type,
      source: `tier1 fallback (conf ${tier1.confidence})`,
    }
  }

  return { type: 'Other', source: 'default (both tiers failed)' }
}

// ---------- Preflight ----------

async function preflight() {
  console.log('Preflight: testing Anthropic API (no tools)...')
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    })
    console.log(
      `  ✓ Basic call works. Model: ${r.model}. Usage: ${r.usage?.input_tokens}in/${r.usage?.output_tokens}out`
    )
  } catch (err) {
    console.error('  ✗ Basic call FAILED — key/account issue:')
    console.error('    status:', err?.status, '  message:', err?.message)
    if (err?.error) console.error('    body:', JSON.stringify(err.error))
    process.exit(1)
  }

  console.log('Preflight: testing web_search tool (used by tier 2)...')
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [
        { role: 'user', content: 'Use web_search to find what year it currently is, then reply with just the year number.' },
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    })
    console.log(
      `  ✓ Web search works. Usage: ${r.usage?.input_tokens}in/${r.usage?.output_tokens}out + ${r.usage?.server_tool_use?.web_search_requests || 0} search(es)`
    )
  } catch (err) {
    console.error('  ⚠ Web search call FAILED — tier 2 fallback will not work,')
    console.error('     but tier 1 will still classify obvious cases (Fund, Payer, Consulting, etc.).')
    console.error('     Continuing with tier-1-only inference...')
    console.error('     status:', err?.status, '  message:', err?.message)
  }
  console.log('')
}

// ---------- Main ----------

async function main() {
  await preflight()

  console.log('Fetching watchlist from Supabase...')
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('id, company, type, sector, reason')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Supabase error:', error.message)
    process.exit(1)
  }

  const all = rows || []
  console.log(`Fetched ${all.length} total watchlist rows.`)

  const toProcess = FORCE ? all : all.filter((r) => !r.type)
  const skippedAsTyped = all.length - toProcess.length

  console.log(
    `Will process ${toProcess.length} rows` +
      (skippedAsTyped > 0
        ? ` (${skippedAsTyped} already have a type — use --force to redo them)`
        : '')
  )
  if (LIMIT && LIMIT < toProcess.length) {
    console.log(`--limit=${LIMIT} set, stopping after ${LIMIT}`)
  }
  if (DRY_RUN) console.log('DRY RUN — no Supabase writes will happen.')
  console.log('')

  const target = LIMIT ? toProcess.slice(0, LIMIT) : toProcess

  let updated = 0
  let failed = 0
  const counts = Object.fromEntries(WATCHLIST_TYPES.map((t) => [t, 0]))

  for (let i = 0; i < target.length; i++) {
    const r = target[i]
    const progress = `(${i + 1}/${target.length})`
    try {
      const { type: newType, source } = await inferType(r)

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('watchlist')
          .update({ type: newType })
          .eq('id', r.id)
        if (updateErr) throw new Error(`Supabase update failed: ${updateErr.message}`)
      }

      updated++
      counts[newType]++
      const oldLabel = r.type ? ` (was: ${r.type})` : ''
      console.log(`✓  ${r.company}: ${newType}${oldLabel} — ${source} ${progress}`)
    } catch (err) {
      failed++
      console.error(`✗  Failed ${r.company}: ${err.message || err} ${progress}`)
      // Keep going — one failure never stops the run
    }
  }

  console.log('')
  console.log('─────────────────────────────────────────────')
  console.log(`Done. Updated: ${updated}   Failed: ${failed}`)
  console.log('Type breakdown:')
  for (const t of WATCHLIST_TYPES) {
    if (counts[t] > 0) console.log(`  ${t.padEnd(14)} ${counts[t]}`)
  }
  if (DRY_RUN) console.log('(Dry run — nothing was written.)')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
