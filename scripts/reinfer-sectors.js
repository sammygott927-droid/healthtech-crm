#!/usr/bin/env node
/**
 * Standalone sector re-inference script.
 *
 * Runs locally with no Vercel / serverless timeout. Fetches contacts from
 * Supabase, calls the Anthropic API with web search enabled for each one,
 * and writes the inferred sector back to Supabase incrementally so partial
 * progress is saved even if the script is interrupted.
 *
 * USAGE (from project root):
 *   node --env-file=.env.local scripts/reinfer-sectors.js
 *
 * Optional flags:
 *   --force         Re-process ALL contacts, even those with specific sectors
 *   --dry-run       Print what would change without writing to Supabase
 *   --limit=N       Stop after N contacts (useful for testing)
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

// Defense against Claude Code / shell env collision:
// The Anthropic SDK falls back to process.env.ANTHROPIC_API_KEY when no key is
// passed, and some code paths may honor it even if apiKey IS passed. If the
// shell has a different ANTHROPIC_API_KEY set (e.g. from Claude Code, billed
// to a different account), we'd silently hit that account and get a credit
// balance error even though our actual key has credit. Wipe it so only the
// explicit key below is used.
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== ANTHROPIC_KEY) {
  console.log(
    'Note: stripping ANTHROPIC_API_KEY from env (likely set by Claude Code) — using CLAUDE_API_KEY from .env.local instead.'
  )
  delete process.env.ANTHROPIC_API_KEY
}

// Sanity print: show which key prefix we're about to use, so a wrong account
// is obvious before the first API call.
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

// Sectors we consider "generic" — contacts with these (or null/blank) get re-processed.
// Anything else is treated as already-specific and skipped unless --force is passed.
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
Return ONE short sector/niche. The shape of the answer depends on whether this person works at an INVESTOR firm or an OPERATOR/STARTUP. Get this distinction right — it's the most common mistake.

═══════════════════════════════════════════════════
RULE 1 — INVESTORS (VC firms, growth equity, PE, LPs, angel investors)
═══════════════════════════════════════════════════
Reflect the FIRM'S BROAD INVESTMENT MANDATE — the full set of areas they invest across. Do NOT narrow to a single portfolio company or one recent deal.

- ❌ WRONG: F-Prime → "pediatrics" (that's one portfolio bet, not the mandate)
- ✅ RIGHT: F-Prime → "healthcare services, digital health, and life sciences investing"

- ❌ WRONG: General Catalyst → "primary care" (just one investment)
- ✅ RIGHT: General Catalyst → "healthcare services and digital health investing"

- ❌ WRONG: a16z Bio + Health → "oncology"
- ✅ RIGHT: a16z Bio + Health → "bio, digital health, and healthcare services investing"

- ❌ WRONG: Oak HC/FT → "Medicare Advantage"
- ✅ RIGHT: Oak HC/FT → "healthcare services and fintech investing"

HOW TO REASON FOR INVESTORS:
1. Search the firm's stated investment thesis, mandate, and portfolio categories. Look at their website's "what we invest in" or "focus areas" pages.
2. Summarize the FULL mandate, not one slice. Use 2-4 broad domains joined by "and" — e.g. "healthcare services and digital health investing", "biotech and life sciences investing", "healthcare services, digital health, and life sciences investing".
3. Include stage if clearly specialized ("Series A digital health and biotech investing"; "growth-stage healthcare services investing"). Omit stage for multi-stage generalist firms.
4. Always end with the word "investing" (or "investor" if notes indicate the person is an LP / solo capital allocator, not at a firm).
5. If the notes specifically narrow this contact's personal focus within the firm (e.g. "she only covers oncology at F-Prime"), THEN you can narrow — but you need explicit evidence from the notes, not inference.

GOOD investor sectors:
- "healthcare services and digital health investing"
- "healthcare services, digital health, and life sciences investing"
- "biotech and life sciences investing"
- "Series A digital health investing"
- "growth-stage value-based care investing"
- "healthcare services and fintech investing"

BAD investor sectors (too narrow / conflates one deal with the mandate):
- "pediatrics", "oncology", "Medicare Advantage" (unless it's a single-thesis fund)
- "healthtech VC", "digital health" (too generic)
- "Investor" (that's a role)

═══════════════════════════════════════════════════
RULE 2 — OPERATORS / STARTUPS / PROVIDERS
═══════════════════════════════════════════════════
Be SPECIFIC. Name the clinical domain, patient population, or care setting the company actually serves. Think like a healthcare insider describing WHAT the company does for WHICH patients, not how it's built or sold.

1. Read the company name AND the notes together. Notes usually reveal what the company actually does — don't guess from the name.
   - "Jukebox Health" sounds like music-tech. Notes say in-home care for aging adults → "home health".
   - "Maven Clinic" → notes mention women's health + fertility → "women's health / fertility".
2. Anchor on the CLINICAL DOMAIN (condition / population) or MARKET SEGMENT (payer, care setting).
3. AVOID software-category language. Do NOT use: "SaaS", "platform", "app", "marketplace", "software", "enablement platform". Those describe packaging, not sector.
4. For services/provider businesses, name the care type directly: "home health", "primary care", "dialysis", "hospice", "behavioral health", "specialty pharmacy".

GOOD operator sectors (2-5 words, clinical reality):
- "home health", "value-based primary care", "Medicare Advantage plan", "maternal health", "pulmonary rehab", "pediatric behavioral health", "specialty pharmacy", "hospice and palliative care", "women's health / fertility", "oncology care delivery", "dialysis / ESRD", "chronic care management", "senior care / aging in place"

BAD operator sectors:
- "provider enablement SaaS", "care coordination platform", "digital health platform"
- "Healthcare", "Health Tech", "Digital Health", "Medical", "Wellness"
- "Operator" (that's a role)

═══════════════════════════════════════════════════
RULE 3 — CONSULTANTS
═══════════════════════════════════════════════════
Encode practice area: "hospital M&A advisory", "payer strategy consulting", "health system operations consulting". Not "Consultant" (role) or "Healthcare" (too broad).`

function buildPrompt(contact) {
  const notes = contact.notes || []
  const notesBlock =
    notes.length > 0
      ? notes
          .map(
            (n, i) =>
              `Note ${i + 1}: ${n.summary}${n.full_notes ? `\n  Details: ${n.full_notes}` : ''}`
          )
          .join('\n\n')
      : '(no notes)'

  return `You are a healthcare networking CRM assistant. Infer a single specific healthcare sector/niche for this contact.

Contact:
- Name: ${contact.name}
- Role: ${contact.role || 'Unknown'}
- Company: ${contact.company || 'Unknown'}
- Current sector (may be wrong/generic): ${contact.sector || '(none)'}

Notes:
${notesBlock}

PROCESS:
1. FIRST, determine whether this is an INVESTOR or an OPERATOR. Role field says "${contact.role || 'Unknown'}". If Investor, you must reflect the firm's FULL mandate — not a single portfolio company.
2. Use the web_search tool to find ground truth:
   - For INVESTORS: search "${contact.company || contact.name} investment thesis" AND "${contact.company || contact.name} focus areas" AND "${contact.company || contact.name} portfolio categories". Read their website's "what we invest in" page. List the FULL set of sectors they invest across (e.g. "healthcare services, digital health, life sciences") — not just one deal.
   - For OPERATORS: search "${contact.company || contact.name} healthcare" or "${contact.company || contact.name} what does it do". Identify the clinical domain / patient population.
3. Ground your answer in what search reveals. Do NOT guess from the company name alone.
4. If the notes contradict or refine what search shows, trust the notes. For investors, notes only override the broad mandate if they explicitly say this contact personally covers a narrower slice.

${SECTOR_STYLE_GUIDANCE}

OUTPUT FORMAT — STRICT:
After any web search, your FINAL message must be ONLY the sector string on a single line — no JSON, no quotes, no citations, no explanation, no preamble like "Sector:". Just the phrase itself. If you genuinely cannot determine the sector even after searching, output the single word: UNKNOWN`
}

// ---------- Core ----------

async function inferSector(contact) {
  let response
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: buildPrompt(contact) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    })
  } catch (err) {
    // Anthropic SDK errors carry: status, message, error (body), headers, request_id.
    // Dump everything we can see so the root cause is visible — credit balance,
    // model gating, web-search permission, rate limits, etc.
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
      // Only print the headers that matter for diagnosis
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

  // The final answer is in the LAST text block (web search returns
  // server_tool_use + web_search_tool_result blocks interleaved).
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

// Preflight: a tiny API call with no tools, then a tiny one WITH web search.
// Lets us distinguish "key/account broken" from "web search not enabled on this tier".
async function preflight() {
  console.log('Preflight: testing Anthropic API (no tools)...')
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just: ok' }],
    })
    const orgId = r?._request_id ? '' : ''
    console.log(`  ✓ Basic call works. Model: ${r.model}. Usage: ${r.usage?.input_tokens}in/${r.usage?.output_tokens}out${orgId}`)
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

  console.log('Fetching contacts from Supabase...')
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, name, role, company, sector, notes(summary, full_notes)')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Supabase error:', error.message)
    process.exit(1)
  }

  const allContacts = contacts || []
  console.log(`Fetched ${allContacts.length} total contacts.`)

  // Filter to the ones we'll actually process
  const toProcess = FORCE ? allContacts : allContacts.filter((c) => isGeneric(c.sector))
  const skippedAsSpecific = allContacts.length - toProcess.length

  console.log(
    `Will process ${toProcess.length} contacts` +
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
    const c = target[i]
    const progress = `(${i + 1}/${target.length})`
    try {
      const newSector = await inferSector(c)

      if (newSector === null) {
        skippedUnknown++
        console.log(`⊘  Skipped ${c.name} — AI returned UNKNOWN ${progress}`)
        continue
      }

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('contacts')
          .update({ sector: newSector })
          .eq('id', c.id)
        if (updateErr) throw new Error(`Supabase update failed: ${updateErr.message}`)
      }

      updated++
      const oldLabel = c.sector ? ` (was: ${c.sector})` : ''
      console.log(`✓  Updated ${c.name}: ${newSector}${oldLabel} ${progress}`)
    } catch (err) {
      failed++
      console.error(`✗  Failed ${c.name}: ${err.message || err} ${progress}`)
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
