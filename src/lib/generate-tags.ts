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

export async function generateTagsForImport(
  contactId: string,
  context: ContactContext
): Promise<string[]> {
  const prompt = `You are a healthcare networking CRM assistant. Based on the following contact info, generate 3-5 short, specific tags that describe what this person or their company is relevant to. Tags should be useful for monitoring healthcare news.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

Return ONLY a JSON array of tag strings. Example: ["pediatric VBC", "Medicaid", "Series A healthtech"]`

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
  // Get existing tags to avoid duplicates
  const { data: existingTags } = await supabase
    .from('tags')
    .select('tag')
    .eq('contact_id', contactId)

  const existingTagList = existingTags?.map((t) => t.tag) || []

  const prompt = `You are a healthcare networking CRM assistant. Based on a new note added to a contact, suggest 1-3 NEW tags that capture specific topics mentioned in the note. Only suggest tags that are NOT already in the existing tags list.

Contact:
- Name: ${context.name}
- Role: ${context.role || 'Unknown'}
- Company: ${context.company || 'Unknown'}
- Sector: ${context.sector || 'Unknown'}

Existing tags: ${JSON.stringify(existingTagList)}

New note summary: ${noteSummary}
${noteFullText ? `Full notes: ${noteFullText}` : ''}

Return ONLY a JSON array of new tag strings. If no new tags are warranted, return an empty array []. Tags should be short and specific to healthcare/business topics mentioned.`

  const tags = await callClaudeForTags(prompt)
  if (tags.length > 0) {
    await saveTags(contactId, tags, 'auto-note')
  }
  return tags
}

async function callClaudeForTags(prompt: string): Promise<string[]> {
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []

    return parsed.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim())
  } catch (err) {
    console.error('Tag generation failed:', err)
    return []
  }
}

async function saveTags(contactId: string, tags: string[], source: string) {
  const rows = tags.map((tag) => ({ contact_id: contactId, tag, source }))
  await supabase.from('tags').insert(rows)
}
