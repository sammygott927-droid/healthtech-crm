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

// Shared prompt guidance on the kind of language we want
const TAG_STYLE_GUIDANCE = `TAG STYLE — CRITICAL:
Use specific, insider healthcare language that reflects how investors/operators actually talk. NOT generic buckets.

GOOD tags (specific, insider):
- "value-based care", "VBC", "pulmonary rehab", "pediatrics", "autoimmune"
- "Medicaid managed care", "home health", "maternal health tech"
- "early-stage healthtech", "Series A healthtech", "seed healthtech investing"
- "Medicare Advantage", "provider enablement", "specialty pharmacy"
- "PBM reform", "340B", "RPM", "digital therapeutics"
- "clinical trials tech", "oncology", "behavioral health"

BAD tags (too generic — avoid these):
- "digital health", "healthcare", "health IT", "healthtech investing"
- "technology", "startups", "business", "medicine"
- "investor", "operator" (role is already tracked separately)

Prefer 2-4 word specific themes over 1-word broad buckets. Think thesis areas, clinical domains, payer types, regulatory angles, and stage-specific investing language.`

export async function generateTagsForImport(
  contactId: string,
  context: ContactContext
): Promise<string[]> {
  const prompt = `You are a healthcare networking CRM assistant. Based on the following contact info, generate 3-5 short, specific tags that describe this person's thesis areas, clinical domains, or work focus. Tags will be used to monitor relevant healthcare news.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

${TAG_STYLE_GUIDANCE}

Return ONLY a JSON array of tag strings. Example: ["value-based care", "Medicare Advantage", "provider enablement", "Series B healthtech"]`

  const tags = await callClaudeForTags(prompt)
  await saveTags(contactId, tags, 'auto-import')
  return tags
}

export async function generateTagsForNote(
  contactId: string,
  context: ContactContext,
  noteSummary: string,
  noteFullText: string | null
): Promise<string[]> {
  const { data: existingTags } = await supabase
    .from('tags')
    .select('tag')
    .eq('contact_id', contactId)

  const existingTagList = existingTags?.map((t) => t.tag) || []

  const prompt = `You are a healthcare networking CRM assistant. A new note was added to a contact. Extract 1-3 NEW specific thesis/interest tags that capture topics mentioned in the note — NOT tags already in the existing list.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

Existing tags: ${JSON.stringify(existingTagList)}

New note summary: ${noteSummary}
${noteFullText ? `Full notes: ${noteFullText}` : ''}

${TAG_STYLE_GUIDANCE}

Return ONLY a JSON array of new tag strings. If no new tags are warranted, return an empty array [].`

  const tags = await callClaudeForTags(prompt)
  if (tags.length > 0) {
    await saveTags(contactId, tags, 'auto-note')
  }
  return tags
}

// Re-generate all tags for a contact based on their current data + notes
// Replaces auto-generated tags; preserves manually-added tags.
export async function regenerateTagsForContact(
  contactId: string,
  context: ContactContext,
  notes: NoteContext[]
): Promise<string[]> {
  const notesBlock = notes.length > 0
    ? notes.map((n, i) => `Note ${i + 1}: ${n.summary}${n.full_notes ? `\n  Details: ${n.full_notes}` : ''}`).join('\n\n')
    : '(no notes)'

  const prompt = `You are a healthcare networking CRM assistant. Generate 4-7 specific tags for this contact based on their profile AND their note history. The notes contain critical thesis/interest signals — mine them for specific clinical domains, investment themes, regulatory interests, and niche areas.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

Notes history:
${notesBlock}

${TAG_STYLE_GUIDANCE}

Mine the notes carefully. If a note mentions "pulmonary rehab" — tag it. If it mentions "VBC partnerships with MA plans" — tag "value-based care" and "Medicare Advantage". If it mentions "looking at Series A opportunities in autoimmune" — tag "autoimmune" and "Series A healthtech".

Return ONLY a JSON array of tag strings.`

  const tags = await callClaudeForTags(prompt)

  // Preserve manual tags, replace auto-generated ones
  const { data: manualTags } = await supabase
    .from('tags')
    .select('id, tag')
    .eq('contact_id', contactId)
    .eq('source', 'manual')

  const manualTagSet = new Set((manualTags || []).map(t => t.tag.toLowerCase()))

  // Delete all auto-generated tags for this contact
  await supabase
    .from('tags')
    .delete()
    .eq('contact_id', contactId)
    .neq('source', 'manual')

  // Insert new auto-generated tags, skipping any that duplicate manual tags
  const newTags = tags.filter(t => !manualTagSet.has(t.toLowerCase()))
  if (newTags.length > 0) {
    await saveTags(contactId, newTags, 'auto-regen')
  }

  return tags
}

// Suggest tags for a draft contact (no saving) — used by the Add Contact form
export async function suggestTagsForDraft(
  context: ContactContext,
  noteText?: string
): Promise<string[]> {
  const prompt = `You are a healthcare networking CRM assistant. Based on this draft contact info, suggest 3-5 specific tags.

Contact:
- Name: ${context.name || '(not yet entered)'}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}
${noteText ? `\nInitial notes: ${noteText}` : ''}

${TAG_STYLE_GUIDANCE}

Return ONLY a JSON array of tag strings.`

  return callClaudeForTags(prompt)
}

async function callClaudeForTags(prompt: string): Promise<string[]> {
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((t: unknown) => typeof t === 'string' && t.trim())
      .map((t: string) => t.trim())
  } catch (err) {
    console.error('Tag generation failed:', err)
    return []
  }
}

async function saveTags(contactId: string, tags: string[], source: string) {
  if (tags.length === 0) return
  const rows = tags.map((tag) => ({ contact_id: contactId, tag, source }))
  await supabase.from('tags').insert(rows)
}
