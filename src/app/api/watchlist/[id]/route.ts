import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set([
  'Fund',
  'Startup',
  'Growth Stage',
  'Incubator',
  'Health System',
  'Payer',
  'Consulting',
  'Other',
])

const SELECT_COLUMNS =
  'id, company, type, sector, stage, description, reason, notes, auto_added, created_at'

/**
 * GET /api/watchlist/:id
 *
 * Returns the full watchlist row plus two related-data sections used by
 * the detail page:
 *   - related_contacts: contacts whose `company` matches this watchlist
 *     row's company (case-insensitive), OR whose notes mention the
 *     company name in raw_notes / summary / full_notes.
 *   - recent_articles:  past scored articles from daily_briefs whose
 *     headline mentions the company (cheap ILIKE, no Claude call).
 *
 * Both are best-effort database-only lookups; the detail page falls back
 * to an empty list when nothing matches.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: row, error } = await supabase
    .from('watchlist')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .single()

  if (error || !row) {
    return NextResponse.json(
      { error: error?.message || 'Watchlist entry not found' },
      { status: 404 }
    )
  }

  const company = (row.company as string).trim()
  const pattern = `%${company}%`

  // Related contacts — two queries in parallel.
  // 1. Contacts whose `company` field matches (case-insensitive).
  // 2. Contacts whose notes (raw_notes, summary, full_notes) mention the
  //    company by name. Join through the notes table.
  const [byCompanyRes, byNotesRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, role, company, status, sector')
      .ilike('company', company),
    supabase
      .from('notes')
      .select('contact_id, contacts(id, name, role, company, status, sector)')
      .or(
        `raw_notes.ilike.${pattern},summary.ilike.${pattern},full_notes.ilike.${pattern}`
      ),
  ])

  type ContactSummary = {
    id: string
    name: string
    role: string | null
    company: string | null
    status: string | null
    sector: string | null
    matched_on: 'company' | 'notes'
  }

  const byId = new Map<string, ContactSummary>()
  for (const c of byCompanyRes.data || []) {
    byId.set(c.id as string, {
      id: c.id as string,
      name: c.name as string,
      role: (c.role as string | null) ?? null,
      company: (c.company as string | null) ?? null,
      status: (c.status as string | null) ?? null,
      sector: (c.sector as string | null) ?? null,
      matched_on: 'company',
    })
  }

  for (const n of byNotesRes.data || []) {
    // The joined contacts relation comes back as an object or array depending
    // on Supabase typing; normalize.
    const rel = (n as {
      contacts?:
        | {
            id?: string
            name?: string
            role?: string | null
            company?: string | null
            status?: string | null
            sector?: string | null
          }
        | { id?: string; name?: string; role?: string | null; company?: string | null; status?: string | null; sector?: string | null }[]
    }).contacts
    const c = Array.isArray(rel) ? rel[0] : rel
    if (!c?.id || !c.name) continue
    if (byId.has(c.id)) continue // already matched via company; don't overwrite
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      role: c.role ?? null,
      company: c.company ?? null,
      status: c.status ?? null,
      sector: c.sector ?? null,
      matched_on: 'notes',
    })
  }

  const related_contacts = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  // Recent articles — scan daily_briefs.headline for the company name.
  // No Claude call, pure SQL. Cap at 25 most recent.
  const { data: articles } = await supabase
    .from('daily_briefs')
    .select(
      'id, headline, source_url, source_name, pub_date, so_what, relevance_tag, relevance_score, created_at'
    )
    .ilike('headline', pattern)
    .order('created_at', { ascending: false })
    .limit(25)

  return NextResponse.json({
    ...row,
    related_contacts,
    recent_articles: articles || [],
  })
}

// DELETE /api/watchlist/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('watchlist').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// PATCH /api/watchlist/:id
// Accepts: company, type, sector, stage, description, reason, notes.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const update: Record<string, string | null> = {}

  const textFields = [
    'company',
    'sector',
    'stage',
    'description',
    'reason',
    'notes',
  ] as const
  for (const field of textFields) {
    if (field in body) {
      const v = body[field]
      if (typeof v === 'string') {
        update[field] = v.trim() || null
      } else if (v === null) {
        update[field] = null
      }
    }
  }

  // Type field is enum-validated.
  if ('type' in body) {
    const v = body.type
    if (v === null || v === '') {
      update.type = null
    } else if (typeof v === 'string' && ALLOWED_TYPES.has(v.trim())) {
      update.type = v.trim()
    } else {
      return NextResponse.json(
        { error: `type must be one of: ${[...ALLOWED_TYPES].join(', ')}` },
        { status: 400 }
      )
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('watchlist')
    .update(update)
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Another watchlist entry already uses that company name' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
