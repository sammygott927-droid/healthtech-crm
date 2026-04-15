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
Return ONE short, specific healthcare sector/niche — the kind of phrase an insider would use to describe where this person actually works or focuses. Think clinical domain + business model, not broad industry buckets.

GOOD sectors (specific, insider):
- "value-based care / Medicare Advantage"
- "pulmonary rehab"
- "home health operations"
- "early-stage healthtech investing"
- "Series A digital health"
- "pediatric behavioral health"
- "specialty pharmacy / 340B"
- "provider enablement SaaS"
- "maternal health tech"
- "clinical trials tech"
- "oncology diagnostics"
- "payer-provider analytics"
- "PBM / pharmacy benefits"
- "RPM / chronic care management"
- "healthcare M&A advisory"
- "hospital operations consulting"

BAD sectors (too generic — avoid):
- "Healthcare", "Health Tech", "Digital Health", "Medical"
- "Technology", "Software", "Business", "Consulting"
- "Investor", "Operator" (role, not sector)
- "Startup", "Enterprise"

Prefer 2-5 words. If the person is an investor, encode their thesis (stage + domain). If an operator, encode their company's business model + clinical focus. If a consultant, encode their practice area.`

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
