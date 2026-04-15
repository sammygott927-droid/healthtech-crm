import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { structureNotesForContact } from '@/lib/structure-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Rebuild the structured notes view for every contact that has at least one note.
// Contacts with no notes are skipped (and their fields left as-is).
export async function POST() {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, notes(summary, full_notes, created_at)')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ message: 'No contacts found', processed: 0 })
    }

    const withNotes = contacts.filter((c) => Array.isArray(c.notes) && c.notes.length > 0)

    const results: { id: string; name: string }[] = []
    const errors: { id: string; name: string; error: string }[] = []

    for (const contact of withNotes) {
      try {
        await structureNotesForContact(
          contact.id,
          {
            name: contact.name,
            role: contact.role,
            company: contact.company,
            sector: contact.sector,
          },
          contact.notes as { summary: string; full_notes: string | null; created_at?: string }[]
        )
        results.push({ id: contact.id, name: contact.name })
      } catch (err) {
        errors.push({ id: contact.id, name: contact.name, error: String(err) })
      }
    }

    return NextResponse.json({
      success: true,
      total_contacts: contacts.length,
      contacts_with_notes: withNotes.length,
      processed: results.length,
      errors: errors.length,
      error_details: errors,
    })
  } catch (err) {
    console.error('Restructure all failed:', err)
    return NextResponse.json(
      { error: 'Restructure all failed', details: String(err) },
      { status: 500 }
    )
  }
}
