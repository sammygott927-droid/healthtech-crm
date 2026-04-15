import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Re-infer a specific niche sector for every contact, using notes as signal.
// Contacts with no notes and no existing sector hints are still attempted
// (profile fields alone may be enough). If Claude returns UNKNOWN, the
// existing sector is preserved.
export async function POST() {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, notes(summary, full_notes)')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ message: 'No contacts found', processed: 0 })
    }

    const results: { id: string; name: string; old: string | null; new: string }[] = []
    const skipped: { id: string; name: string; reason: string }[] = []
    const errors: { id: string; name: string; error: string }[] = []

    for (const contact of contacts) {
      try {
        const newSector = await inferSectorForContact(
          contact.id,
          {
            name: contact.name,
            role: contact.role,
            company: contact.company,
            sector: contact.sector,
          },
          (contact.notes as { summary: string; full_notes: string | null }[]) || []
        )

        if (newSector === null) {
          skipped.push({ id: contact.id, name: contact.name, reason: 'AI returned UNKNOWN' })
        } else {
          results.push({ id: contact.id, name: contact.name, old: contact.sector, new: newSector })
        }
      } catch (err) {
        errors.push({ id: contact.id, name: contact.name, error: String(err) })
      }
    }

    return NextResponse.json({
      success: true,
      total_contacts: contacts.length,
      updated: results.length,
      skipped: skipped.length,
      errors: errors.length,
      results,
      skipped_details: skipped,
      error_details: errors,
    })
  } catch (err) {
    console.error('Re-infer sectors failed:', err)
    return NextResponse.json(
      { error: 'Re-infer sectors failed', details: String(err) },
      { status: 500 }
    )
  }
}
