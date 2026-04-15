import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/watchlist?search=&sortBy=&sortDir=
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim() || ''
  const sortBy = searchParams.get('sortBy') || 'created_at'
  const sortDir = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc'

  const allowedSorts = new Set(['company', 'sector', 'created_at'])
  const orderCol = allowedSorts.has(sortBy) ? sortBy : 'created_at'

  let q = supabase
    .from('watchlist')
    .select('id, company, sector, reason, auto_added, created_at')
    .order(orderCol, { ascending: sortDir === 'asc' })

  if (search) {
    q = q.or(`company.ilike.%${search}%,sector.ilike.%${search}%,reason.ilike.%${search}%`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST /api/watchlist — { company, sector?, reason? }
export async function POST(request: NextRequest) {
  let body: { company?: unknown; sector?: unknown; reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const company = typeof body.company === 'string' ? body.company.trim() : ''
  const sector = typeof body.sector === 'string' ? body.sector.trim() || null : null
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null

  if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('watchlist')
    .insert({ company, sector, reason, auto_added: false })
    .select('id, company, sector, reason, auto_added, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This company is already on the watchlist' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
