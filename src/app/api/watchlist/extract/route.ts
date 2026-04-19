import { NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractCompaniesFromText } from '@/lib/extract-companies-from-text'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/watchlist/extract — mine contact notes for company mentions
// that aren't already on the watchlist or in contacts.company, then add
// them with auto_added=true. Returns {added, candidates}.
export async function POST() {
  // Pull all notes (prefer raw_notes; fall back to legacy summary/full_notes).
  const { data: notes, error: nErr } = await supabase
    .from('notes')
    .select('raw_notes, summary, full_notes, contact_id, contacts(company)')

  if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 })
  if (!notes || notes.length === 0) {
    return NextResponse.json({ added: 0, candidates: [] })
  }

  // Build a single corpus string across all notes (cap each note so the
  // combined prompt stays under Claude's context budget).
  const corpus = notes
    .map((n, i) => {
      const rel = (n as {
        contacts?: { company?: string | null } | { company?: string | null }[]
      }).contacts
      const relCompany = Array.isArray(rel) ? rel[0]?.company : rel?.company
      const ctx = relCompany ? ` [contact's company: ${relCompany}]` : ''
      const body = (n.raw_notes as string | null) ||
        [n.summary, n.full_notes].filter(Boolean).join(' — ')
      return `Note ${i + 1}${ctx}: ${String(body ?? '').slice(0, 600)}`
    })
    .join('\n\n')

  const [{ data: contacts }, { data: watchlist }] = await Promise.all([
    supabase.from('contacts').select('company'),
    supabase.from('watchlist').select('company'),
  ])

  const known = new Set<string>()
  for (const c of contacts || []) {
    const v = (c.company as string | null)?.trim()
    if (v) known.add(v)
  }
  for (const w of watchlist || []) {
    const v = (w.company as string | null)?.trim()
    if (v) known.add(v)
  }

  const candidates = await extractCompaniesFromText(corpus, known)

  if (candidates.length === 0) {
    return NextResponse.json({ added: 0, candidates: [] })
  }

  const rows = candidates.map((c) => ({
    company: c.company,
    reason: c.reason,
    auto_added: true,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('watchlist')
    .upsert(rows, { onConflict: 'company', ignoreDuplicates: true })
    .select('id, company, sector, reason')

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Background type inference for the rows we just added
  if (inserted && inserted.length > 0) {
    after(async () => {
      const result = await inferWatchlistTypeForMany(
        inserted.map((r) => ({
          id: r.id as string,
          company: r.company as string,
          sector: (r.sector as string | null) || null,
          reason: (r.reason as string | null) || null,
        }))
      )
      console.log(
        `[watchlist extract] type inference: ${result.ok} ok, ${result.failed} failed`
      )
    })
  }

  return NextResponse.json({
    added: inserted?.length || 0,
    candidates,
  })
}
