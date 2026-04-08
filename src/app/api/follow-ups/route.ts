import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, name, company, last_contact_date, follow_up_cadence_days, status')
    .neq('status', 'Dormant')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const today = new Date()
  const upcoming: typeof contacts = []
  const overdue: typeof contacts = []

  for (const c of contacts || []) {
    if (!c.last_contact_date) continue

    const last = new Date(c.last_contact_date)
    const dueDate = new Date(last.getTime() + c.follow_up_cadence_days * 24 * 60 * 60 * 1000)
    const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
      overdue.push({ ...c, days_overdue: Math.abs(diffDays) } as typeof c)
    } else if (diffDays <= 7) {
      upcoming.push({ ...c, days_until_due: diffDays } as typeof c)
    }
  }

  // Sort overdue by most overdue first, upcoming by soonest first
  overdue.sort((a, b) => ((b as Record<string, number>).days_overdue || 0) - ((a as Record<string, number>).days_overdue || 0))
  upcoming.sort((a, b) => ((a as Record<string, number>).days_until_due || 0) - ((b as Record<string, number>).days_until_due || 0))

  return NextResponse.json({ upcoming, overdue })
}
