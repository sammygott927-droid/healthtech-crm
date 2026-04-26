import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { parsePlainDate, todayLocal, daysBetween } from '@/lib/plain-date'

export async function GET() {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, name, company, last_contact_date, follow_up_cadence_days, status')
    .neq('status', 'Dormant')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Cadence math is calendar-day, not millisecond, so use LOCAL midnight
  // anchors throughout. `parsePlainDate` keeps "2026-01-13" as Jan 13 even
  // in negative-offset zones — the prior `new Date(s)` parsed it as UTC
  // midnight, which `.toLocaleDateString()` then rolled back to Jan 12 in
  // the US.
  const today = todayLocal()
  const upcoming: typeof contacts = []
  const overdue: typeof contacts = []

  for (const c of contacts || []) {
    if (!c.last_contact_date) continue

    const last = parsePlainDate(c.last_contact_date)
    if (!last) continue
    const due = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + c.follow_up_cadence_days
    )
    const diffDays = daysBetween(today, due)

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
