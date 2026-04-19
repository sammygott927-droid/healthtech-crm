import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/briefs-today/:id — update status (Sent | Dismissed).
 *
 * Task 9 item 18: when marked as Sent, also update the linked contact's
 * last_contact_date to today. This keeps follow-up cadence tracking in
 * sync with actual outreach without requiring a separate click.
 */
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

  // Fetch the brief row before updating so we can see which contact (if any)
  // it's linked to.
  const { data: briefRow, error: readErr } = await supabase
    .from('daily_briefs')
    .select('contact_id')
    .eq('id', id)
    .single()

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  const { error: updateErr } = await supabase
    .from('daily_briefs')
    .update({ status })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // If marked as Sent and there's a linked contact, bump last_contact_date
  // to today so follow-up math is correct going forward.
  if (status === 'Sent' && briefRow?.contact_id) {
    const today = new Date().toISOString().split('T')[0]
    const { error: contactErr } = await supabase
      .from('contacts')
      .update({ last_contact_date: today })
      .eq('id', briefRow.contact_id)
    if (contactErr) {
      console.error(
        `[briefs-today PATCH] failed to update last_contact_date for ${briefRow.contact_id}:`,
        contactErr.message
      )
    }
  }

  return NextResponse.json({ ok: true })
}
