import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferWatchlistType } from '@/lib/infer-watchlist-type'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Re-infer Type for a single watchlist row.
 *
 * Uses the tiered inference pipeline:
 *   1. Tier 1: Claude classification from name + sector alone (no web search)
 *   2. Tier 2: web search with 10s timeout if tier 1 was uncertain
 *   3. Default to 'Other' if both fail
 *
 * Always persists a value (never null), so the badge resolves immediately.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { data: row, error } = await supabase
      .from('watchlist')
      .select('id, company, sector, reason, type')
      .eq('id', id)
      .single()

    if (error || !row) {
      return NextResponse.json(
        { error: error?.message || 'Watchlist entry not found' },
        { status: 404 }
      )
    }

    const newType = await inferWatchlistType(row.id, {
      company: row.company,
      sector: row.sector,
      reason: row.reason,
    })

    return NextResponse.json({
      success: true,
      type: newType,
      previous_type: row.type,
    })
  } catch (err) {
    console.error(`[reinfer-watchlist-type ${id}] Failed:`, err)
    return NextResponse.json(
      { error: 'Type inference failed', details: String(err).slice(0, 500) },
      { status: 500 }
    )
  }
}
