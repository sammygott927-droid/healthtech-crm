import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
}

export const NOTE_CATEGORIES = [
  'How we met',
  'Areas of interest',
  'Advice given',
  'Key takeaways',
  'Next steps',
  'Miscellaneous',
] as const

export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

export interface StructuredNotes {
  summary: string
  structured: Partial<Record<NoteCategory, string[]>>
}

interface ContactContext {
  name: string
  role?: string | null
  company?: string | null
  sector?: string | null
}

interface NoteInput {
  summary: string
  full_notes: string | null
  created_at?: string
}

/**
 * Takes all notes for a contact, calls Claude to produce:
 *  - A 1-2 sentence summary of the most important takeaways
 *  - A structured view grouped into six categories (empty categories omitted)
 *
 * Persists the result on the contact row (notes_summary + notes_structured).
 * Returns the structured result. Throws on AI failure or DB failure — callers
 * that want fire-and-forget behavior should wrap in .catch().
 */
export async function structureNotesForContact(
  contactId: string,
  context: ContactContext,
  notes: NoteInput[]
): Promise<StructuredNotes> {
  if (!notes || notes.length === 0) {
    // Clear the structured fields — contact has no notes
    await supabase
      .from('contacts')
      .update({ notes_summary: null, notes_structured: null })
      .eq('id', contactId)
    return { summary: '', structured: {} }
  }

  // Build the notes block in chronological order (oldest first for narrative flow)
  const sorted = [...notes].sort((a, b) => {
    if (!a.created_at || !b.created_at) return 0
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const notesBlock = sorted
    .map((n, i) => {
      const date = n.created_at ? new Date(n.created_at).toLocaleDateString() : ''
      return `Note ${i + 1}${date ? ` (${date})` : ''}:\n  Summary: ${n.summary}${n.full_notes ? `\n  Details: ${n.full_notes}` : ''}`
    })
    .join('\n\n')

  const prompt = `You are a healthcare networking CRM assistant. Review all notes about this contact and reorganize them into a structured view.

CONTACT:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

ALL NOTES (chronological):
${notesBlock}

Produce the following as JSON:
{
  "summary": "1-2 sentence summary of the most important takeaways about this contact — what defines the relationship and what's top of mind. Punchy and specific, not generic.",
  "structured": {
    "How we met": ["bullet", "bullet"],
    "Areas of interest": ["bullet", "bullet"],
    "Advice given": ["bullet"],
    "Key takeaways": ["bullet", "bullet"],
    "Next steps": ["bullet"],
    "Miscellaneous": ["bullet"]
  }
}

RULES:
1. Extract bullets directly from the notes — don't invent content.
2. Each bullet should be a concise phrase or sentence (not a single word, not a long paragraph).
3. OMIT any category that has no relevant content. If there are no "Next steps" mentioned in the notes, leave that key out of the JSON entirely — do not include empty arrays.
4. "Miscellaneous" is only for content that truly doesn't fit the other categories — don't use it as a dumping ground.
5. "Areas of interest" = their thesis/clinical/investment focus areas (e.g. "Focused on VBC partnerships with Medicare Advantage plans").
6. "Advice given" = advice THEY gave to me (the user), not advice I gave them.
7. "Key takeaways" = notable insights or observations about them that don't fit elsewhere.
8. If a note spans multiple categories, split it across them.

Return ONLY valid JSON, no other text.`

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Robust JSON extraction: first '{' to last '}'
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Note structuring: no JSON object in response (got: ${text.slice(0, 200)})`)
  }

  const jsonStr = text.slice(firstBrace, lastBrace + 1)
  let parsed: { summary?: string; structured?: Record<string, unknown> }
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    throw new Error(`Note structuring: invalid JSON (${String(err)})`)
  }

  // Sanitize — only keep known categories, only non-empty string[] arrays
  const cleanStructured: Partial<Record<NoteCategory, string[]>> = {}
  for (const category of NOTE_CATEGORIES) {
    const value = parsed.structured?.[category]
    if (Array.isArray(value)) {
      const bullets = value
        .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
        .map((b) => b.trim())
      if (bullets.length > 0) {
        cleanStructured[category] = bullets
      }
    }
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''

  // Persist on the contact row
  const { error: updateErr } = await supabase
    .from('contacts')
    .update({
      notes_summary: summary || null,
      notes_structured: Object.keys(cleanStructured).length > 0 ? cleanStructured : null,
    })
    .eq('id', contactId)

  if (updateErr) {
    throw new Error(`Failed to save structured notes: ${updateErr.message}`)
  }

  return { summary, structured: cleanStructured }
}

/**
 * Per-note structuring (Task 1). Takes a single raw note (the blob the user
 * pasted), asks Claude to produce a 1-2 sentence summary and category
 * bucketing, and writes ai_summary + ai_structured back onto that note row.
 *
 * Each note becomes its own conversation card on the contact page.
 */
export async function structureSingleNote(
  noteId: string,
  context: ContactContext,
  rawNotes: string
): Promise<StructuredNotes> {
  const trimmed = rawNotes.trim()
  if (!trimmed) {
    return { summary: '', structured: {} }
  }

  const prompt = `You are a healthcare networking CRM assistant. Below is a single conversation/interaction note about a contact. Produce a punchy AI summary and bucket the contents into categories.

CONTACT:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

RAW NOTE:
${trimmed}

Produce the following as JSON:
{
  "summary": "1-2 sentence summary of what happened in this conversation and the most important takeaway. Specific, not generic.",
  "structured": {
    "How we met": ["bullet"],
    "Areas of interest": ["bullet"],
    "Advice given": ["bullet"],
    "Key takeaways": ["bullet"],
    "Next steps": ["bullet"],
    "Miscellaneous": ["bullet"]
  }
}

RULES:
1. Extract bullets directly from the note — don't invent content.
2. OMIT any category that has no relevant content. Do not include empty arrays.
3. "Areas of interest" = their thesis/clinical/investment focus areas.
4. "Advice given" = advice THEY gave to me (the user), not advice I gave them.
5. "Key takeaways" = notable insights about them that don't fit elsewhere.
6. "Miscellaneous" only for content that truly doesn't fit other categories.
7. Each bullet is a concise phrase or sentence — not a single word, not a paragraph.

Return ONLY valid JSON, no other text.`

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Single-note structuring: no JSON object in response (got: ${text.slice(0, 200)})`)
  }

  const jsonStr = text.slice(firstBrace, lastBrace + 1)
  let parsed: { summary?: string; structured?: Record<string, unknown> }
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    throw new Error(`Single-note structuring: invalid JSON (${String(err)})`)
  }

  const cleanStructured: Partial<Record<NoteCategory, string[]>> = {}
  for (const category of NOTE_CATEGORIES) {
    const value = parsed.structured?.[category]
    if (Array.isArray(value)) {
      const bullets = value
        .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
        .map((b) => b.trim())
      if (bullets.length > 0) {
        cleanStructured[category] = bullets
      }
    }
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''

  const { error: updateErr } = await supabase
    .from('notes')
    .update({
      ai_summary: summary || null,
      ai_structured: Object.keys(cleanStructured).length > 0 ? cleanStructured : null,
    })
    .eq('id', noteId)

  if (updateErr) {
    throw new Error(`Failed to save structured single note: ${updateErr.message}`)
  }

  return { summary, structured: cleanStructured }
}
