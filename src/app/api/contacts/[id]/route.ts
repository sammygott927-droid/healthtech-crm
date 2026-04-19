import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'
import { regenerateTagsForContact } from '@/lib/generate-tags'
import { syncContactsToWatchlist } from '@/lib/sync-contacts-to-watchlist'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'
import { inferWatchlistSector } from '@/lib/infer-watchlist-sector'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: contact, error } = await supabase
    .from('contacts')
    .select(
      '*, tags(id, tag, source), notes(id, raw_notes, ai_summary, ai_structured, summary, full_notes, created_at)'
    )
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  // Sort notes newest first
  if (contact.notes) {
    contact.notes.sort((a: { created_at: string }, b: { created_at: string }) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }

  return NextResponse.json(contact)
}

/**
 * PATCH /api/contacts/:id
 *
 * Background auto-processing when `company` changes (Task 9 items 11-14):
 *   - Re-infer sector for the new company
 *   - Regenerate tags from new context
 *   - Add the new company to watchlist (with type + sector inference)
 *   - Old company stays on watchlist untouched (intrinsic — watchlist is
 *     not linked to contacts, so we never remove from it)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const allowed = [
    'status', 'next_step', 'next_step_date', 'follow_up_cadence_days',
    'last_contact_date', 'name', 'role', 'company', 'sector', 'email',
    'phone', 'referral_source',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Detect company change before writing so we can diff.
  const { data: prev } = await supabase
    .from('contacts')
    .select('company')
    .eq('id', id)
    .single()

  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const prevCompany = (prev?.company as string | null) ?? null
  const newCompany = (data.company as string | null) ?? null
  const normalizedPrev = prevCompany?.trim().toLowerCase() ?? ''
  const normalizedNew = newCompany?.trim().toLowerCase() ?? ''
  const companyChanged =
    'company' in updates &&
    Boolean(newCompany) &&
    normalizedPrev !== normalizedNew

  if (companyChanged) {
    const ctx = {
      name: data.name,
      role: data.role,
      company: data.company,
      sector: data.sector,
    }

    after(async () => {
      // 1. Re-infer sector for the new company. Pass empty notes so the
      //    inference leans on the new company; the style guide is strong
      //    enough to reclassify from just company+role.
      try {
        await inferSectorForContact(id, ctx, [])
      } catch (err) {
        console.error(`[contacts PATCH] sector re-infer for ${data.name}:`, err)
      }

      // 2. Sync contact companies → watchlist. This picks up the new
      //    company automatically (and leaves the old one on the watchlist
      //    untouched). Type + sector inference for newly-added rows.
      try {
        const newRows = await syncContactsToWatchlist()
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
              console.error(
                `[contacts PATCH] watchlist sector for ${row.company}:`,
                err
              )
            }
          }
        }
      } catch (err) {
        console.error(`[contacts PATCH] watchlist sync failed:`, err)
      }

      // 3. Regenerate tags using the freshly-inferred sector.
      try {
        const { data: refreshed } = await supabase
          .from('contacts')
          .select('name, role, company, sector')
          .eq('id', id)
          .single()

        const { data: notes } = await supabase
          .from('notes')
          .select('summary, full_notes')
          .eq('contact_id', id)

        if (refreshed) {
          await regenerateTagsForContact(
            id,
            refreshed,
            (notes || []).map((n) => ({
              summary: (n.summary as string) || '',
              full_notes: (n.full_notes as string | null) ?? null,
            }))
          )
        }
      } catch (err) {
        console.warn(`[contacts PATCH] tag regen:`, String(err).slice(0, 200))
      }
    })
  }

  return NextResponse.json(data)
}
