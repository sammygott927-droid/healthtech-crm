import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/watchlist/sync — add every distinct contact.company that isn't
// already on the watchlist. Flags new rows as auto_added=true.
export async function POST() {
  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('company, sector')
    .neq('status', 'Dormant')

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Dedupe by lowercase company name, keep first-seen sector as default
  const byKey = new Map<string, { company: string; sector: string | null }>()
  for (const c of contacts || []) {
    const company = (c.company as string | null)?.trim()
    if (!company) continue
    const key = company.toLowerCase()
    if (!byKey.has(key)) {
      byKey.set(key, { company, sector: (c.sector as string | null) || null })
    }
  }

  if (byKey.size === 0) {
    return NextResponse.json({ added: 0, skipped: 0 })
  }

  const { data: existing, error: eErr } = await supabase.from('watchlist').select('company')
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

  const existingSet = new Set((existing || []).map((w) => (w.company as string).toLowerCase()))

  const toInsert: { company: string; sector: string | null; auto_added: boolean }[] = []
  for (const [key, row] of byKey.entries()) {
    if (existingSet.has(key)) continue
    toInsert.push({ company: row.company, sector: row.sector, auto_added: true })
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ added: 0, skipped: byKey.size })
  }

  const { error: insErr } = await supabase.from('watchlist').insert(toInsert)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ added: toInsert.length, skipped: byKey.size - toInsert.length })
}
