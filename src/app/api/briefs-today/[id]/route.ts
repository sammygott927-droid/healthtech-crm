import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// PATCH /api/briefs-today/[id] — update status (Sent | Dismissed)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: { status?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const status = typeof body.status === 'string' ? body.status : ''
  if (status !== 'Sent' && status !== 'Dismissed') {
    return NextResponse.json({ error: 'status must be Sent or Dismissed' }, { status: 400 })
  }

  const { error } = await supabase
    .from('daily_briefs')
    .update({ status })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
