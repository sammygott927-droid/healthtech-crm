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
const ANTHROPIC_KEY = process.env.CLAUDE_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.error('Missing CLAUDE_API_KEY in .env.local')
  process.exit(1)
}

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
Return ONE short, specific healthcare sector/niche — the clinical domain or market segment this person actually works in. Think like a healthcare insider describing WHAT the company does for WHICH patients, not how it's built or sold.

HOW TO REASON:
1. Read the company name AND the notes together. The notes usually reveal what the company actually does. Don't guess from the name alone.
   - Example: "Jukebox Health" sounds like music-tech. Notes say they deliver in-home care to aging adults → sector is "home health", NOT "digital health" or "SaaS".
2. Anchor on the CLINICAL DOMAIN (what condition/population) and/or MARKET SEGMENT (payer, care setting, business model in healthcare-native terms).
3. AVOID software-category language. Do NOT use: "SaaS", "platform", "app", "marketplace", "software", "tech stack", "enablement platform".
4. If the company is clearly a services/provider business, name the care type directly: "home health", "primary care", "dialysis", "hospice", "behavioral health", "specialty pharmacy".
5. For investors: encode stage + clinical thesis ("Series A women's health", "growth-stage value-based care"), not "healthtech VC".
6. For consultants: encode practice area ("hospital M&A advisory", "payer strategy consulting").

GOOD sectors: "home health", "value-based primary care", "Medicare Advantage", "maternal health", "pulmonary rehab", "pediatric behavioral health", "specialty pharmacy", "hospice and palliative care", "women's health / fertility", "oncology care delivery", "dialysis / ESRD", "chronic care management", "senior care / aging in place", "clinical trials", "Series A digital health investing", "growth-stage value-based care investing", "hospital operations consulting".

BAD sectors: "provider enablement SaaS", "digital health platform", "Healthcare", "Health Tech", "Digital Health", "Software", "Investor", "Operator".

Prefer 2-5 words. Name the clinical reality, not the tech wrapper.`

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
1. FIRST, use the web_search tool to look up what the company actually does. Search queries like "${contact.company || contact.name} healthcare" or "${contact.company || contact.name} company what does it do". For investors/funds, search the firm name + "portfolio" or "healthcare investments".
2. Ground your answer in what search reveals about the company's actual business — clinical domain, patient population, care setting, or investment thesis. Do NOT guess from the company name alone.
3. If the notes contradict or refine what search shows, trust the notes — they came from a real conversation.

${SECTOR_STYLE_GUIDANCE}

OUTPUT FORMAT — STRICT:
After any web search, your FINAL message must be ONLY the sector string on a single line — no JSON, no quotes, no citations, no explanation, no preamble like "Sector:". Just the phrase itself. If you genuinely cannot determine the sector even after searching, output the single word: UNKNOWN`
}

// ---------- Core ----------

async function inferSector(contact) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildPrompt(contact) }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  })

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

async function main() {
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
