import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'
import { regenerateTagsForContact } from '@/lib/generate-tags'
import { syncContactsToWatchlist } from '@/lib/sync-contacts-to-watchlist'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'
import { inferWatchlistSector } from '@/lib/infer-watchlist-sector'

export const dynamic = 'force-dynamic'
// Background work runs via after(). Three independent hooks (sector,
// watchlist, tags) run concurrently, so the budget needs to cover the
// slowest branch — watchlist-sector-for-many-rows can hit ~2-3 min when a
// big CRM is first synced. After the first successful sync, subsequent POSTs
// only process 1 new company.
export const maxDuration = 300

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

  // Default cadence: 180 days (6 months). Overridden by body.follow_up_cadence_days
  // if the form/API caller explicitly supplies a value.
  const cadence =
    typeof body.follow_up_cadence_days === 'number' && body.follow_up_cadence_days > 0
      ? body.follow_up_cadence_days
      : 180

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

  // Background auto-processing — non-blocking.
  //
  // Prior version ran sector inference + watchlist sync + sector inference for
  // each new watchlist row + tag regen SEQUENTIALLY inside one after(). The
  // watchlist sector inference loop alone can eat >40s per row on Vercel, so
  // a single after() could blow the 60s function budget before it ever got to
  // tag regen — OR, in the reported bug, the user would see the blank sector
  // and never refresh the page, assuming it was broken.
  //
  // Fix: kick off THREE independent after() hooks — sector inference on its
  // own (the critical path), watchlist sync on its own, tag regen on its own.
  // Even if one times out, the others run to completion.
  const shouldInferSector = Boolean(created.company) && !contactData.sector

  if (shouldInferSector) {
    after(async () => {
      const t0 = Date.now()
      console.log(`[contacts POST sector] starting for ${created.name} (${created.company})`)
      try {
        const result = await inferSectorForContact(
          created.id,
          {
            name: created.name,
            role: created.role,
            company: created.company,
            sector: created.sector,
          },
          []
        )
        console.log(
          `[contacts POST sector] done in ${Date.now() - t0}ms for ${created.name} → ${result ?? 'UNKNOWN (not saved)'}`
        )
      } catch (err) {
        console.error(
          `[contacts POST sector] FAILED for ${created.name} after ${Date.now() - t0}ms:`,
          err
        )
      }
    })
  }

  after(async () => {
    const t0 = Date.now()
    console.log(`[contacts POST watchlist] starting`)
    try {
      const newRows = await syncContactsToWatchlist()
      console.log(`[contacts POST watchlist] sync done in ${Date.now() - t0}ms, ${newRows.length} new rows`)
      if (newRows.length > 0) {
        await inferWatchlistTypeForMany(newRows)
        for (const row of newRows) {
          try {
            await inferWatchlistSector(row.id, {
              company: row.company,
              sector: row.sector,
              reason: row.reason,
            })
          } catch (err) {
            console.error(`[contacts POST watchlist] sector for ${row.company} failed:`, err)
          }
        }
      }
      console.log(`[contacts POST watchlist] all done in ${Date.now() - t0}ms`)
    } catch (err) {
      console.error(`[contacts POST watchlist] FAILED:`, err)
    }
  })

  after(async () => {
    const t0 = Date.now()
    console.log(`[contacts POST tags] starting for ${created.name}`)
    try {
      const { data: refreshed } = await supabase
        .from('contacts')
        .select('name, role, company, sector')
        .eq('id', created.id)
        .single()
      if (refreshed) {
        await regenerateTagsForContact(created.id, refreshed, [])
      }
      console.log(`[contacts POST tags] done in ${Date.now() - t0}ms`)
    } catch (err) {
      // Non-fatal — if Claude returns nothing we just leave form-submitted tags
      console.warn(
        `[contacts POST tags] for ${created.name} after ${Date.now() - t0}ms:`,
        String(err).slice(0, 200)
      )
    }
  })

  return NextResponse.json(created, { status: 201 })
}
