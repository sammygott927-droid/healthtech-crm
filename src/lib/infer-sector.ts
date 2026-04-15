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
Return ONE short, specific healthcare sector/niche — the clinical domain or market segment this person actually works in. Think like a healthcare insider describing WHAT the company does for WHICH patients, not how it's built or sold.

HOW TO REASON:
1. Read the company name AND the notes together. The notes usually reveal what the company actually does. Don't guess from the name alone.
   - Example: "Jukebox Health" sounds like music-tech. Notes say they deliver in-home care to aging adults → sector is "home health", NOT "digital health" or "SaaS".
   - Example: "Maven Clinic" → notes mention women's health + fertility → "women's health / fertility", NOT "telehealth platform".
2. Anchor on the CLINICAL DOMAIN (what condition/population) and/or MARKET SEGMENT (payer, care setting, business model in healthcare-native terms).
3. AVOID software-category language. Do NOT use: "SaaS", "platform", "app", "marketplace", "software", "tech stack", "enablement platform". These describe how the product is packaged, not what the sector is.
4. If the company is clearly a services/provider business (delivering care), name the care type directly: "home health", "primary care", "dialysis", "hospice", "behavioral health", "specialty pharmacy".
5. For investors: encode stage + clinical thesis ("Series A women's health", "growth-stage value-based care"), not "healthtech VC".
6. For consultants: encode practice area ("hospital M&A advisory", "payer strategy consulting").

GOOD sectors (clinical/market niche language):
- "home health"
- "value-based primary care"
- "Medicare Advantage"
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
- "autoimmune"
- "clinical trials"
- "Series A digital health investing"
- "growth-stage value-based care investing"
- "hospital operations consulting"

BAD sectors (software category, generic, or misleading):
- "provider enablement SaaS", "care coordination platform", "digital health platform"
- "Healthcare", "Health Tech", "Digital Health", "Medical", "Wellness"
- "Technology", "Software", "Startup", "Enterprise"
- "Investor", "Operator", "Consultant" (that's a role, not a sector)

Prefer 2-5 words. Name the clinical reality, not the tech wrapper.`

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

  const prompt = `You are a healthcare networking CRM assistant. Based on this contact's profile and notes, infer a single specific healthcare sector/niche that best describes where they work or focus.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Current sector (may be wrong/generic): ${context.sector || '(none)'}

Notes:
${notesBlock}

${SECTOR_STYLE_GUIDANCE}

Return ONLY the sector string as plain text — no JSON, no quotes, no explanation. If you genuinely can't tell from the info, return the single word: UNKNOWN`

  let text: string
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    })
    text = response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (err) {
    throw new Error(`Sector inference: AI call failed (${String(err)})`)
  }

  // Clean: trim, strip surrounding quotes, collapse whitespace
  const cleaned = text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
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
