import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
}

interface WatchlistContext {
  company: string
  sector?: string | null
  reason?: string | null
}

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

/**
 * Infer a specific healthcare sector for a single watchlist company.
 *
 * Watchlist rows have no `role` field, so we use a two-step prompt:
 *   1. Ask Claude to classify the COMPANY TYPE from the web
 *      (investor, operator, health_system, consulting)
 *   2. Apply the matching style guide
 *
 * This keeps investor firms from collapsing to a single portfolio bet.
 *
 * Persists to watchlist.sector and returns the inferred value.
 * Returns null if Claude couldn't produce anything usable
 * (existing sector preserved on null).
 */
export async function inferWatchlistSector(
  watchlistId: string,
  context: WatchlistContext
): Promise<string | null> {
  const reasonLine = context.reason ? `- Reason tracked: ${context.reason}` : ''
  const currentSectorLine = context.sector
    ? `- Current sector (may be wrong/generic): ${context.sector}`
    : ''

  const prompt = `You are a healthcare networking CRM assistant. Infer a single sector/niche for this watchlist company.

Watchlist entry:
- Company: ${context.company}
${currentSectorLine}
${reasonLine}

─── STEP 1: CLASSIFY THE COMPANY TYPE ───
Use the web_search tool to determine what kind of organization "${context.company}" is. Search queries like:
  "${context.company} company" OR "${context.company} about"
  "${context.company} investment thesis" (if it might be a VC / investor)

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

  let text: string
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
    })
    // Final answer is in the LAST text block (web search adds server_tool_use
    // and web_search_tool_result blocks in between).
    const textBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text'
    )
    text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''
  } catch (err) {
    throw new Error(`Watchlist sector inference: AI call failed (${String(err)})`)
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const lastLine = lines[lines.length - 1] || ''
  const cleaned = lastLine
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^sector:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned || cleaned.toUpperCase() === 'UNKNOWN' || cleaned.length > 80) {
    return null
  }

  const { error: updateErr } = await supabase
    .from('watchlist')
    .update({ sector: cleaned })
    .eq('id', watchlistId)

  if (updateErr) {
    throw new Error(`Failed to save watchlist sector: ${updateErr.message}`)
  }

  return cleaned
}
