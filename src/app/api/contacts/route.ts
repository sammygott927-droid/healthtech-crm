import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'
import { regenerateTagsForContact } from '@/lib/generate-tags'
import { syncContactsToWatchlist } from '@/lib/sync-contacts-to-watchlist'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'
import { inferWatchlistSector } from '@/lib/infer-watchlist-sector'

export const dynamic = 'force-dynamic'
// Background work (sector inference etc.) runs via after(); 60s window gives
// tier 2 web search room to finish.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const status = url.searchParams.get('status') || ''
  const role = url.searchParams.get('role') || ''
  const sector = url.searchParams.get('sector') || ''
  const sortBy = url.searchParams.get('sortBy') || 'name'
  const sortDir = url.searchParams.get('sortDir') === 'desc' ? false : true

  let query = supabase.from('contacts').select('*, tags(tag)')

  if (search) {
    query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%`)
  }
  if (status) query = query.eq('status', status)
  if (role) query = query.eq('role', role)
  if (sector) query = query.ilike('sector', `%${sector}%`)

  const sortColumn = ['name', 'company', 'last_contact_date'].includes(sortBy) ? sortBy : 'name'
  query = query.order(sortColumn, { ascending: sortDir, nullsFirst: false })

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/**
 * POST /api/contacts — create a new contact.
 *
 * Background auto-processing (fires in after() so the user gets the new
 * contact card instantly and AI runs afterwards):
 *   - Sector inference (if company provided and sector not explicitly set)
 *   - Tag regeneration from full context + notes
 *   - Watchlist sync (contact's company added to watchlist if new)
 *   - Watchlist type inference for any newly-added rows
 *   - Watchlist sector inference for the newly-added row (when we can reach it)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Task 9 item 6: Investor/Operator → 60 days, Consultant → 120 days.
  const cadence = body.role === 'Consultant' ? 120 : 60

  // Task 9 item 7: last_contact_date left BLANK by default. Only set if the
  // user explicitly provided one via the form. Previously this defaulted to
  // today's date regardless of form input.
  const lastContactDate =
    typeof body.last_contact_date === 'string' && body.last_contact_date.trim()
      ? body.last_contact_date
      : null

  const contactData = {
    name: body.name.trim(),
    role: body.role || null,
    company: body.company?.trim() || null,
    sector: body.sector?.trim() || null,
    referral_source: body.referral_source?.trim() || null,
    status: body.status || 'Active',
    next_step: body.next_step?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    follow_up_cadence_days: cadence,
    last_contact_date: lastContactDate,
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert(contactData)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Persist any tags the form submitted (user-curated from the AI suggestions).
  if (Array.isArray(body.tags) && body.tags.length > 0) {
    const tagRows = body.tags
      .map((t: unknown) => (typeof t === 'string' ? t.trim() : ''))
      .filter((t: string) => t.length > 0)
      .map((tag: string) => ({
        contact_id: created.id,
        tag,
        source: 'auto-import',
      }))

    if (tagRows.length > 0) {
      await supabase.from('tags').insert(tagRows)
    }
  }

  // Background auto-processing — non-blocking
  after(async () => {
    const ctx = {
      name: created.name,
      role: created.role,
      company: created.company,
      sector: created.sector,
    }

    // 1. Sector inference (skip if user explicitly provided one on the form)
    const shouldInferSector = Boolean(created.company) && !contactData.sector
    if (shouldInferSector) {
      try {
        await inferSectorForContact(created.id, ctx, [])
      } catch (err) {
        console.error(`[contacts POST] sector inference failed for ${created.name}:`, err)
      }
    }

    // 2. Watchlist sync — adds contact.company to watchlist if new, then
    //    type + sector inference for any freshly-added rows.
    try {
      const newRows = await syncContactsToWatchlist()
      if (newRows.length > 0) {
        // Type inference (tiered, fast) for all new rows
        await inferWatchlistTypeForMany(newRows)
        // Sector inference for all new rows (web search, slower — best effort)
        for (const row of newRows) {
          try {
            await inferWatchlistSector(row.id, {
              company: row.company,
              sector: row.sector,
              reason: row.reason,
            })
          } catch (err) {
            console.error(`[contacts POST] watchlist sector for ${row.company} failed:`, err)
          }
        }
      }
    } catch (err) {
      console.error(`[contacts POST] watchlist sync failed:`, err)
    }

    // 3. Tag regeneration from full context + notes (runs AFTER sector inference
    //    so the freshly-inferred sector informs tag selection). Preserves any
    //    manual tags the user added.
    try {
      const { data: refreshed } = await supabase
        .from('contacts')
        .select('name, role, company, sector')
        .eq('id', created.id)
        .single()
      if (refreshed) {
        await regenerateTagsForContact(created.id, refreshed, [])
      }
    } catch (err) {
      // Non-fatal — if Claude returns nothing we just leave form-submitted tags
      console.warn(`[contacts POST] tag regen for ${created.name}:`, String(err).slice(0, 200))
    }

    // Note: watchlist extraction from initial notes happens inside POST
    // /api/notes, which the new-contact form calls separately for the
    // initial_notes field. No duplication needed here.
  })

  return NextResponse.json(created, { status: 201 })
}
