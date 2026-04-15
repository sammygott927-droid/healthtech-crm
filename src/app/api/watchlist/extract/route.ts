import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) throw new Error('CLAUDE_API_KEY is not set')
  return new Anthropic({ apiKey: key })
}

// POST /api/watchlist/extract — mine contact notes for company mentions
// that aren't already on the watchlist or in contacts.company, then add
// them with auto_added=true. Returns {added, candidates}.
export async function POST() {
  // Pull all notes + contact company context
  const { data: notes, error: nErr } = await supabase
    .from('notes')
    .select('summary, full_notes, contact_id, contacts(company)')

  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 })
  if (!notes || notes.length === 0) {
    return NextResponse.json({ added: 0, candidates: [] })
  }

  // Build the text corpus (cap each note to keep prompt reasonable)
  const corpus = notes
    .map((n, i) => {
      // contacts may come back as object or array depending on Supabase typing
      const rel = (n as { contacts?: { company?: string | null } | { company?: string | null }[] }).contacts
      const relCompany = Array.isArray(rel) ? rel[0]?.company : rel?.company
      const ctx = relCompany ? ` [contact's company: ${relCompany}]` : ''
      const body = [n.summary, n.full_notes].filter(Boolean).join(' — ')
      return `Note ${i + 1}${ctx}: ${String(body).slice(0, 600)}`
    })
    .join('\n\n')

  // Fetch everything already known so we can exclude it in the prompt
  const [{ data: contacts }, { data: watchlist }] = await Promise.all([
    supabase.from('contacts').select('company'),
    supabase.from('watchlist').select('company'),
  ])

  const knownSet = new Set<string>()
  for (const c of contacts || []) {
    const v = (c.company as string | null)?.trim().toLowerCase()
    if (v) knownSet.add(v)
  }
  for (const w of watchlist || []) {
    const v = (w.company as string | null)?.trim().toLowerCase()
    if (v) knownSet.add(v)
  }
  const knownList = Array.from(knownSet).slice(0, 300)

  const prompt = `You are a healthcare networking CRM assistant. Below are notes from various 1:1 conversations. Extract the names of health-tech / healthcare companies mentioned in these notes that could be worth tracking in daily news monitoring.

RULES:
- Only real company names (not roles, clinical concepts, or generic terms like "home health").
- Skip vague mentions ("a startup in oncology") — only named companies.
- Skip companies already in this known list: ${JSON.stringify(knownList)}
- If a company is mentioned only in passing with no signal it's worth tracking, skip it.
- For each company, give a one-sentence reason (why it showed up / why track it).

NOTES:
${corpus.slice(0, 12000)}

Return ONLY a JSON array, no other text. Example:
[
  { "company": "Devoted Health", "reason": "Mentioned by two contacts as a top MA innovator." },
  { "company": "Cedar", "reason": "Came up re: patient billing thesis." }
]

If nothing qualifies, return [].`

  let candidates: { company: string; reason: string }[] = []
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const first = text.indexOf('[')
    const last = text.lastIndexOf(']')
    if (first === -1 || last === -1 || last <= first) {
      return NextResponse.json({ added: 0, candidates: [], note: 'AI returned no parseable list' })
    }
    const parsed = JSON.parse(text.slice(first, last + 1))
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ added: 0, candidates: [], note: 'AI output not an array' })
    }
    candidates = parsed
      .filter((p: unknown): p is { company: string; reason?: string } => {
        return typeof p === 'object' && p !== null && typeof (p as { company?: unknown }).company === 'string'
      })
      .map((p) => ({
        company: p.company.trim(),
        reason: (typeof p.reason === 'string' ? p.reason.trim() : '') || 'Mentioned in contact notes',
      }))
      .filter((p) => p.company && !knownSet.has(p.company.toLowerCase()))
  } catch (err) {
    console.error('extract-from-notes failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  if (candidates.length === 0) {
    return NextResponse.json({ added: 0, candidates: [] })
  }

  // Insert; skip dupes via onConflict on unique company
  const rows = candidates.map((c) => ({
    company: c.company,
    reason: c.reason,
    auto_added: true,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('watchlist')
    .upsert(rows, { onConflict: 'company', ignoreDuplicates: true })
    .select('company')

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({
    added: inserted?.length || 0,
    candidates,
  })
}
