import Anthropic from '@anthropic-ai/sdk'

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) throw new Error('CLAUDE_API_KEY is not set')
  return new Anthropic({ apiKey: key })
}

export interface CompanyCandidate {
  company: string
  reason: string
}

/**
 * Extract real healthcare/healthtech company mentions from a block of text.
 *
 * Used by:
 *   - POST /api/notes  → silent watchlist extraction from the note the user
 *     just added, so companies mentioned in conversation get tracked
 *     automatically (no UI prompt).
 *   - POST /api/watchlist/extract → global mining of all notes.
 *
 * Returns only candidates NOT in knownCompanies (case-insensitive). Returns
 * an empty array on any AI error — the caller should treat this as
 * fire-and-forget.
 */
export async function extractCompaniesFromText(
  text: string,
  knownCompanies: Iterable<string>
): Promise<CompanyCandidate[]> {
  const trimmed = text.trim()
  if (!trimmed) return []

  const knownSet = new Set(
    [...knownCompanies]
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
  )

  // Cap the "known list" in the prompt so we don't blow the context budget
  // when the CRM has hundreds of contacts.
  const knownList = [...knownSet].slice(0, 300)

  const prompt = `You are a healthcare networking CRM assistant. Extract the names of real health-tech / healthcare companies mentioned in the text below that could be worth tracking in daily news monitoring.

RULES:
- Only real company names (not roles, clinical concepts, or generic terms like "home health" or "value-based care").
- Skip vague mentions ("a startup in oncology") — only NAMED companies.
- Skip companies already in this known list: ${JSON.stringify(knownList)}
- If a company is mentioned only in passing with no signal it's worth tracking, skip it.
- For each company, give a one-sentence reason describing why it came up.

TEXT:
${trimmed.slice(0, 12000)}

Return ONLY a JSON array, no other text. Example:
[
  { "company": "Devoted Health", "reason": "Mentioned as a top MA innovator." },
  { "company": "Cedar", "reason": "Came up re: patient billing." }
]

If nothing qualifies, return [].`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    })

    const responseText = response.content[0].type === 'text' ? response.content[0].text : ''
    const first = responseText.indexOf('[')
    const last = responseText.lastIndexOf(']')
    if (first === -1 || last === -1 || last <= first) return []

    const parsed = JSON.parse(responseText.slice(first, last + 1))
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(
        (p: unknown): p is { company: string; reason?: string } =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as { company?: unknown }).company === 'string'
      )
      .map((p) => ({
        company: p.company.trim(),
        reason: (typeof p.reason === 'string' ? p.reason.trim() : '') || 'Mentioned in notes',
      }))
      .filter((p) => p.company && !knownSet.has(p.company.toLowerCase()))
  } catch (err) {
    console.error('[extract-companies] failed:', err)
    return []
  }
}
