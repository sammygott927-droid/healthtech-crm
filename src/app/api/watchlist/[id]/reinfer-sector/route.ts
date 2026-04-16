import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferWatchlistSector } from '@/lib/infer-watchlist-sector'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Re-infer sector for a single watchlist row (Task 4).
 *
 * Uses the two-step web-search pipeline (classify company type, then
 * apply matching style) so investor firms get their broad mandate and
 * operators get their specific clinical domain.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { data: row, error } = await supabase
      .from('watchlist')
      .select('id, company, sector, reason')
      .eq('id', id)
      .single()

    if (error || !row) {
      return NextResponse.json(
        { error: error?.message || 'Watchlist entry not found' },
        { status: 404 }
      )
    }

    const newSector = await inferWatchlistSector(row.id, {
      company: row.company,
      sector: row.sector,
      reason: row.reason,
    })

    if (newSector === null) {
      return NextResponse.json({
        success: true,
        updated: false,
        sector: row.sector,
        message: 'Could not determine a sector — existing value preserved',
      })
    }

    return NextResponse.json({
      success: true,
      updated: true,
      sector: newSector,
      previous_sector: row.sector,
    })
  } catch (err) {
    console.error(`[reinfer-watchlist-sector ${id}] Failed:`, err)
    return NextResponse.json(
      { error: 'Sector inference failed', details: String(err).slice(0, 500) },
      { status: 500 }
    )
  }
}
