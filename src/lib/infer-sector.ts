import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
}

interface ContactContext {
  name: string
  role?: string | null
  company?: string | null
  sector?: string | null
}

interface NoteContext {
  summary: string
  full_notes: string | null
}

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
- "home health"
- "value-based primary care"
- "Medicare Advantage plan"
- "maternal health"
- "pulmonary rehab"
- "pediatric behavioral health"
- "specialty pharmacy"
- "hospice and palliative care"
- "women's health / fertility"
- "oncology care delivery"
- "dialysis / ESRD"
- "chronic care management"
- "musculoskeletal care"
- "senior care / aging in place"

BAD operator sectors:
- "provider enablement SaaS", "care coordination platform", "digital health platform"
- "Healthcare", "Health Tech", "Digital Health", "Medical", "Wellness"
- "Operator" (that's a role)

═══════════════════════════════════════════════════
RULE 3 — CONSULTANTS
═══════════════════════════════════════════════════
Encode practice area: "hospital M&A advisory", "payer strategy consulting", "health system operations consulting". Not "Consultant" (role) or "Healthcare" (too broad).`

/**
 * Infer a specific, niche healthcare sector for a single contact based on their
 * profile + notes. Persists to contacts.sector and returns the inferred value.
 * Returns null if Claude couldn't produce anything usable (existing sector preserved).
 */
export async function inferSectorForContact(
  contactId: string,
  context: ContactContext,
  notes: NoteContext[]
): Promise<string | null> {
  const notesBlock = notes.length > 0
    ? notes
        .map((n, i) => `Note ${i + 1}: ${n.summary}${n.full_notes ? `\n  Details: ${n.full_notes}` : ''}`)
        .join('\n\n')
    : '(no notes)'

  const prompt = `You are a healthcare networking CRM assistant. Infer a single specific healthcare sector/niche for this contact.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Current sector (may be wrong/generic): ${context.sector || '(none)'}

Notes:
${notesBlock}

PROCESS:
1. FIRST, determine whether this is an INVESTOR or an OPERATOR. Role field says "${context.role || 'Unknown'}". If Investor, you must reflect the firm's FULL mandate — not a single portfolio company.
2. Use the web_search tool to find ground truth:
   - For INVESTORS: search "${context.company || context.name} investment thesis" AND "${context.company || context.name} focus areas" AND "${context.company || context.name} portfolio categories". Read their website's "what we invest in" page. List the FULL set of sectors they invest across (e.g. "healthcare services, digital health, life sciences") — not just one deal.
   - For OPERATORS: search "${context.company || context.name} healthcare" or "${context.company || context.name} what does it do". Identify the clinical domain / patient population.
3. Ground your answer in what search reveals. Do NOT guess from the company name alone.
4. If the notes contradict or refine what search shows, trust the notes. For investors, notes only override the broad mandate if they explicitly say this contact personally covers a narrower slice.
5. Then produce the sector per the style guidance below — broad mandate for investors, specific focus for operators.

${SECTOR_STYLE_GUIDANCE}

OUTPUT FORMAT — STRICT:
After any web search, your FINAL message must be ONLY the sector string on a single line — no JSON, no quotes, no citations, no explanation, no preamble like "Sector:". Just the phrase itself (e.g. "home health" or "Series A women's health investing"). If you genuinely cannot determine the sector even after searching, output the single word: UNKNOWN`

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
    // Web search produces multiple content blocks (server_tool_use, web_search_tool_result, text).
    // The final answer is in the LAST text block.
    const textBlocks = response.content.filter(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text'
    )
    text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''
  } catch (err) {
    throw new Error(`Sector inference: AI call failed (${String(err)})`)
  }

  // Clean: trim, strip surrounding quotes, take only the last non-empty line
  // (in case Claude adds reasoning above despite the instruction)
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
    .from('contacts')
    .update({ sector: cleaned })
    .eq('id', contactId)

  if (updateErr) {
    throw new Error(`Failed to save sector: ${updateErr.message}`)
  }

  return cleaned
}
