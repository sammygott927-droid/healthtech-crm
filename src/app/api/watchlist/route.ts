import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferWatchlistType, WATCHLIST_TYPES, type WatchlistType } from '@/lib/infer-watchlist-type'
import { inferWatchlistSector } from '@/lib/infer-watchlist-sector'

export const dynamic = 'force-dynamic'
// Inline type inference can take up to ~11s (tier 1 ~1s + tier 2 web search
// with a 10s hard timeout). Give the route headroom.
export const maxDuration = 30

const TYPE_SET = new Set<string>(WATCHLIST_TYPES)

// GET /api/watchlist?search=&sortBy=&sortDir=&type=
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim() || ''
  const sortBy = searchParams.get('sortBy') || 'created_at'
  const sortDir = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc'
  const typeFilter = searchParams.get('type')?.trim() || ''

  const allowedSorts = new Set(['company', 'sector', 'type', 'created_at'])
  const orderCol = allowedSorts.has(sortBy) ? sortBy : 'created_at'

  let q = supabase
    .from('watchlist')
    .select(
      'id, company, type, sector, stage, description, reason, notes, auto_added, created_at'
    )
    .order(orderCol, { ascending: sortDir === 'asc' })

  if (search) {
    q = q.or(`company.ilike.%${search}%,sector.ilike.%${search}%,reason.ilike.%${search}%`)
  }

  if (typeFilter && TYPE_SET.has(typeFilter)) {
    q = q.eq('type', typeFilter)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST /api/watchlist — { company, sector?, reason?, type? }
// Type is auto-inferred via web search in the background if not provided.
export async function POST(request: NextRequest) {
  let body: { company?: unknown; sector?: unknown; reason?: unknown; type?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const company = typeof body.company === 'string' ? body.company.trim() : ''
  const sector = typeof body.sector === 'string' ? body.sector.trim() || null : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null
  const typeInput = typeof body.type === 'string' ? body.type.trim() : ''
  const explicitType: WatchlistType | null =
    typeInput && TYPE_SET.has(typeInput) ? (typeInput as WatchlistType) : null

  if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('watchlist')
    .insert({ company, sector, reason, type: explicitType, auto_added: false })
    .select(
      'id, company, type, sector, stage, description, reason, notes, auto_added, created_at'
    )
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This company is already on the watchlist' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Inline type inference if no explicit type was supplied. Tier 1 is fast
  // (~1s for obvious cases) and tier 2's web search has a 10s hard timeout,
  // so worst-case is ~11s — well within maxDuration. Returning the typed
  // row in the response means the UI never has to poll.
  let finalType = data.type
  if (!explicitType) {
    try {
      finalType = await inferWatchlistType(data.id, {
        company: data.company,
        sector,
        reason,
      })
    } catch (err) {
      console.error(`[watchlist POST] type inference failed for ${company}:`, err)
      // inferWatchlistType persists a value itself; only hit this branch on
      // catastrophic failure. Default to 'Other'.
      finalType = 'Other'
      await supabase.from('watchlist').update({ type: 'Other' }).eq('id', data.id)
    }
  }

  // Sector inference (Task 9 item 16) — runs in the background because
  // it uses web search and can take 10-20s. The Re-infer button remains
  // available if the user wants to retry later. Only fires if the user
  // didn't explicitly supply a sector on the form.
  if (!sector) {
    after(async () => {
      try {
        await inferWatchlistSector(data.id, {
          company: data.company,
          sector,
          reason,
        })
      } catch (err) {
        console.error(`[watchlist POST] sector inference for ${company}:`, err)
      }
    })
  }

  return NextResponse.json({ ...data, type: finalType })
}
