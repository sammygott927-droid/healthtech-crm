#!/usr/bin/env node
/**
 * Standalone sector re-inference script for the WATCHLIST table.
 *
 * The watchlist has no `role` field, so step 1 asks Claude to classify the
 * company type from the web (VC/investor firm, startup/operator, health
 * system, consulting firm) before applying sector language. This keeps
 * investor firms from collapsing to a single portfolio bet.
 *
 * USAGE (from project root):
 *   node --env-file=.env.local scripts/reinfer-watchlist-sectors.js
 *
 * Optional flags:
 *   --force         Re-process ALL watchlist rows, even those with specific sectors
 *   --dry-run       Print what would change without writing to Supabase
 *   --limit=N       Stop after N rows (useful for testing)
 */

const Anthropic = require('@anthropic-ai/sdk').default
const { createClient } = require('@supabase/supabase-js')

// ---------- Config ----------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
// We intentionally use CLAUDE_API_KEY (NOT ANTHROPIC_API_KEY) because Claude Code
// sets ANTHROPIC_API_KEY in the shell to a different account's key.
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

// Generic sectors that should be re-processed. Blank/null also counts.
const GENERIC_SECTORS = new Set(
  [
    '',
    'healthcare',
    'health care',
    'healthtech',
    'health tech',
    'health-tech',
    'digital health',
    'health it',
    'medical',
    'medicine',
    'wellness',
    'technology',
    'tech',
    'software',
    'saas',
    'startup',
    'business',
    'consulting',
    'investor',
    'operator',
    'consultant',
    'unknown',
    'n/a',
    'na',
    'other',
    'general',
  ].map((s) => s.toLowerCase())
)

function isGeneric(sector) {
  if (!sector) return true
  return GENERIC_SECTORS.has(sector.trim().toLowerCase())
}

// ---------- Clients ----------

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })

// ---------- Prompt ----------

const SECTOR_STYLE_GUIDANCE = `SECTOR STYLE — CRITICAL:
Return ONE short sector/niche. The shape of the answer depends on the COMPANY TYPE you classified in Step 1. Get the investor-vs-operator distinction right — it's the most common mistake.

═══════════════════════════════════════════════════
IF company_type = "investor"  (VC firm, growth equity, PE, accelerator, LP)
═══════════════════════════════════════════════════
Reflect the FIRM'S BROAD INVESTMENT MANDATE — the full set of areas they invest across. Do NOT narrow to a single portfolio company or one recent deal.

- ❌ WRONG: F-Prime → "pediatrics" (that's one portfolio bet)
- ✅ RIGHT: F-Prime → "healthcare services, digital health, and life sciences investing"

- ❌ WRONG: General Catalyst → "primary care" (just one investment)
- ✅ RIGHT: General Catalyst → "healthcare services and digital health investing"

- ❌ WRONG: a16z Bio + Health → "oncology"
- ✅ RIGHT: a16z Bio + Health → "bio, digital health, and healthcare services investing"

- ❌ WRONG: Oak HC/FT → "Medicare Advantage"
- ✅ RIGHT: Oak HC/FT → "healthcare services and fintech investing"

Rules:
1. Use 2-4 broad domains joined by "and" — e.g. "healthcare services and digital health investing", "biotech and life sciences investing".
2. Include stage only if clearly specialized ("Series A digital health investing"; "growth-stage healthcare services investing"). Omit for multi-stage generalists.
3. Always end with "investing" (or "investor" for a solo capital allocator / LP).

═══════════════════════════════════════════════════
IF company_type = "operator"  (startup, provider, payer, pharma, biotech, device co)
═══════════════════════════════════════════════════
Be SPECIFIC. Name the clinical domain, patient population, or care setting. Think like a healthcare insider describing WHAT the company does for WHICH patients.

Rules:
1. Anchor on CLINICAL DOMAIN (condition / population) or MARKET SEGMENT (payer, care setting).
2. AVOID software-category language: "SaaS", "platform", "app", "marketplace", "enablement platform". Those describe packaging, not sector.
3. For services/provider businesses, name the care type directly.

GOOD: "home health", "value-based primary care", "Medicare Advantage plan", "maternal health", "pulmonary rehab", "pediatric behavioral health", "specialty pharmacy", "hospice and palliative care", "women's health / fertility", "oncology care delivery", "dialysis / ESRD", "chronic care management", "senior care / aging in place", "clinical trials tech", "oncology biotech", "medical devices — cardiovascular".

BAD: "digital health platform", "Healthcare", "Health Tech", "Software", "Operator".

═══════════════════════════════════════════════════
IF company_type = "health_system"  (hospital, IDN, academic medical center, payvider)
═══════════════════════════════════════════════════
Use "health system — <geography or specialty>" or "academic medical center" or "integrated delivery network".

GOOD: "academic medical center", "regional health system — Southeast", "integrated delivery network", "children's hospital system", "Catholic health system".

═══════════════════════════════════════════════════
IF company_type = "consulting"  (strategy firm, advisory, services)
═══════════════════════════════════════════════════
Encode practice area: "hospital M&A advisory", "payer strategy consulting", "health system operations consulting", "pharma commercial strategy consulting".`

function buildPrompt(row) {
  const reasonLine = row.reason ? `- Reason tracked: ${row.reason}` : ''
  const currentSectorLine = row.sector ? `- Current sector (may be wrong/generic): ${row.sector}` : ''

  return `You are a healthcare networking CRM assistant. Infer a single sector/niche for this watchlist company.

Watchlist entry:
- Company: ${row.company}
${currentSectorLine}
${reasonLine}

─── STEP 1: CLASSIFY THE COMPANY TYPE ───
Use the web_search tool to determine what kind of organization "${row.company}" is. Search queries like:
  "${row.company} company" OR "${row.company} about"
  "${row.company} investment thesis" (if it might be a VC / investor)

Classify it as exactly ONE of:
  - "investor"       — VC firm, growth equity, PE, accelerator, LP, family office investing in healthcare
  - "operator"       — startup, provider, payer, pharma, biotech, medical device company (delivers a product or care)
  - "health_system"  — hospital, IDN, academic medical center, payvider
  - "consulting"     — strategy firm, advisory, management consulting practice

Be decisive. If the name has "Capital", "Ventures", "Partners", "Equity", "Fund" — it is almost certainly "investor". If it has "Health System", "Hospital", "Medical Center" — "health_system". Otherwise lean "operator".

─── STEP 2: APPLY THE APPROPRIATE STYLE ───
Based on the company_type you chose in Step 1, apply the matching section of the style guide below. CRITICAL: if you classified this as an investor, you MUST summarize the FULL mandate (2-4 domains joined by "and", ending in "investing") — do NOT narrow to one portfolio company, even if search surfaces a high-profile deal. If you classified as operator, be specific about the clinical domain.

${SECTOR_STYLE_GUIDANCE}

─── OUTPUT FORMAT — STRICT ───
After your web searches, your FINAL message must be ONLY the sector string on a single line — no JSON, no quotes, no citations, no explanation, no preamble like "Sector:". Just the phrase itself (e.g. "home health" or "healthcare services and digital health investing"). If you genuinely cannot determine the sector even after searching, output the single word: UNKNOWN`
}

// ---------- Core ----------

async function inferSector(row) {
  let response
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: buildPrompt(row) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    })
  } catch (err) {
    console.error('')
    console.error('─── Anthropic API error ───')
    console.error('  name:       ', err?.name)
    console.error('  status:     ', err?.status)
    console.error('  request_id: ', err?.request_id || err?.headers?.['request-id'])
    console.error('  message:    ', err?.message)
    if (err?.error !== undefined) {
      console.error('  error body: ', JSON.stringify(err.error, null, 2))
    }
    if (err?.headers) {
      const h = err.headers
      const keys = [
        'anthropic-organization-id',
        'anthropic-ratelimit-requests-remaining',
        'anthropic-ratelimit-tokens-remaining',
        'retry-after',
      ]
      const filtered = {}
      for (const k of keys) if (h[k] !== undefined) filtered[k] = h[k]
      if (Object.keys(filtered).length > 0) {
        console.error('  headers:    ', JSON.stringify(filtered, null, 2))
      }
    }
    console.error('───────────────────────────')
    console.error('')
    throw err
  }

  // Final answer is in the LAST text block (web search adds server_tool_use
  // and web_search_tool_result blocks in between).
  const textBlocks = response.content.filter((b) => b.type === 'text')
  const raw = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const lastLine = lines[lines.length - 1] || ''
  const cleaned = lastLine
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^sector:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned || cleaned.toUpperCase() === 'UNKNOWN' || cleaned.length > 80) {
    return null
  }
  return cleaned
}

// Preflight: same approach as the contacts script.
async function preflight() {
  console.log('Preflight: testing Anthropic API (no tools)...')
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    })
    console.log(`  ✓ Basic call works. Model: ${r.model}. Usage: ${r.usage?.input_tokens}in/${r.usage?.output_tokens}out`)
  } catch (err) {
    console.error('  ✗ Basic call FAILED — key/account issue, not web search:')
    console.error('    status:', err?.status, '  message:', err?.message)
    if (err?.error) console.error('    body:', JSON.stringify(err.error))
    process.exit(1)
  }

  console.log('Preflight: testing web_search tool...')
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Use web_search to find what year it currently is, then reply with just the year number.' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    })
    console.log(`  ✓ Web search works. Usage: ${r.usage?.input_tokens}in/${r.usage?.output_tokens}out + ${r.usage?.server_tool_use?.web_search_requests || 0} search(es)`)
  } catch (err) {
    console.error('  ✗ Web search call FAILED (basic call worked — the issue is specifically web_search):')
    console.error('    status:', err?.status, '  message:', err?.message)
    if (err?.error) console.error('    body:', JSON.stringify(err.error, null, 2))
    console.error('')
    console.error('  Web search may require: organization enabling it in Console → Settings → Privacy & Security,')
    console.error('  or a paid tier with web-search entitlement. Check console.anthropic.com.')
    process.exit(1)
  }
  console.log('')
}

async function main() {
  await preflight()

  console.log('Fetching watchlist from Supabase...')
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('id, company, sector, reason')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Supabase error:', error.message)
    process.exit(1)
  }

  const all = rows || []
  console.log(`Fetched ${all.length} total watchlist rows.`)

  const toProcess = FORCE ? all : all.filter((r) => isGeneric(r.sector))
  const skippedAsSpecific = all.length - toProcess.length

  console.log(
    `Will process ${toProcess.length} rows` +
      (skippedAsSpecific > 0
        ? ` (${skippedAsSpecific} already have a specific sector — use --force to redo them)`
        : '')
  )
  if (LIMIT && LIMIT < toProcess.length) {
    console.log(`--limit=${LIMIT} set, stopping after ${LIMIT}`)
  }
  if (DRY_RUN) console.log('DRY RUN — no Supabase writes will happen.')
  console.log('')

  const target = LIMIT ? toProcess.slice(0, LIMIT) : toProcess

  let updated = 0
  let skippedUnknown = 0
  let failed = 0

  for (let i = 0; i < target.length; i++) {
    const r = target[i]
    const progress = `(${i + 1}/${target.length})`
    try {
      const newSector = await inferSector(r)

      if (newSector === null) {
        skippedUnknown++
        console.log(`⊘  Skipped ${r.company} — AI returned UNKNOWN ${progress}`)
        continue
      }

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('watchlist')
          .update({ sector: newSector })
          .eq('id', r.id)
        if (updateErr) throw new Error(`Supabase update failed: ${updateErr.message}`)
      }

      updated++
      const oldLabel = r.sector ? ` (was: ${r.sector})` : ''
      console.log(`✓  Updated ${r.company}: ${newSector}${oldLabel} ${progress}`)
    } catch (err) {
      failed++
      console.error(`✗  Failed ${r.company}: ${err.message || err} ${progress}`)
      // Keep going — one failure never stops the run
    }
  }

  console.log('')
  console.log('─────────────────────────────────────────────')
  console.log(`Done. Updated: ${updated}   Unknown: ${skippedUnknown}   Failed: ${failed}`)
  if (DRY_RUN) console.log('(Dry run — nothing was written.)')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
