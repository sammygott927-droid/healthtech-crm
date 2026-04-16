import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// DELETE /api/watchlist/[id]
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

// PATCH /api/watchlist/[id] — { sector?, reason?, type? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: { sector?: unknown; reason?: unknown; type?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const update: Record<string, string | null> = {}
  if (typeof body.sector === 'string') update.sector = body.sector.trim() || null
  if (typeof body.reason === 'string') update.reason = body.reason.trim() || null
  if (typeof body.type === 'string' || body.type === null) {
    if (body.type === null || body.type === '') {
      update.type = null
    } else if (typeof body.type === 'string' && ALLOWED_TYPES.has(body.type.trim())) {
      update.type = body.type.trim()
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
    .select('id, company, type, sector, reason, auto_added, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
