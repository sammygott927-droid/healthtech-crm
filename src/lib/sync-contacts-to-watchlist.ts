import { supabase } from './supabase'
import { inferWatchlistTypeForMany } from './infer-watchlist-type'

export interface SyncedRow {
  id: string
  company: string
  sector: string | null
  reason: string | null
}

/**
 * Add every distinct non-Dormant contact.company to the watchlist if it
 * isn't there yet. Marks new rows as auto_added=true. Returns the newly
 * inserted rows so the caller can fire type-inference on them.
 *
 * Pure helper — no HTTP layer. Used by:
 *   - POST /api/contacts (after a new contact is added)
 *   - PATCH /api/contacts/:id (after company is changed)
 *   - /api/daily-brief (at start of each pipeline run)
 *   - POST /api/watchlist/sync (UI button)
 */
export async function syncContactsToWatchlist(): Promise<SyncedRow[]> {
  const { data: contacts, error: cErr } = await supabase
    .from('contacts')
    .select('company, sector')
    .neq('status', 'Dormant')

  if (cErr) {
    console.error('[sync-contacts-to-watchlist] contacts query failed:', cErr.message)
    return []
  }

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

  if (byKey.size === 0) return []

  const { data: existing, error: eErr } = await supabase.from('watchlist').select('company')
  if (eErr) {
    console.error('[sync-contacts-to-watchlist] existing query failed:', eErr.message)
    return []
  }

  const existingSet = new Set(
    (existing || []).map((w) => (w.company as string).toLowerCase())
  )

  const toInsert: { company: string; sector: string | null; auto_added: boolean }[] = []
  for (const [key, row] of byKey.entries()) {
    if (existingSet.has(key)) continue
    toInsert.push({ company: row.company, sector: row.sector, auto_added: true })
  }

  if (toInsert.length === 0) return []

  const { data: inserted, error: insErr } = await supabase
    .from('watchlist')
    .insert(toInsert)
    .select('id, company, sector, reason')

  if (insErr) {
    console.error('[sync-contacts-to-watchlist] insert failed:', insErr.message)
    return []
  }

  const rows = (inserted || []).map((r) => ({
    id: r.id as string,
    company: r.company as string,
    sector: (r.sector as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
  }))

  console.log(`[sync-contacts-to-watchlist] added ${rows.length} new watchlist rows`)
  return rows
}

/**
 * Convenience: sync contacts then kick off type inference for any rows that
 * were freshly added. Returns counts for logging.
 */
export async function syncAndInferTypes(): Promise<{
  added: number
  typed_ok: number
  typed_failed: number
}> {
  const newRows = await syncContactsToWatchlist()
  if (newRows.length === 0) {
    return { added: 0, typed_ok: 0, typed_failed: 0 }
  }
  const { ok, failed } = await inferWatchlistTypeForMany(newRows)
  return { added: newRows.length, typed_ok: ok, typed_failed: failed }
}
