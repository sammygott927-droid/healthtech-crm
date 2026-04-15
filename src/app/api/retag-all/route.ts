import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { regenerateTagsForContact } from '@/lib/generate-tags'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for batch processing

// Re-tag all contacts that have at least one note.
// Preserves manual tags, replaces auto-generated tags with richer ones mined from notes.
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

    // Only process contacts WITH notes (leave blank-note contacts alone)
    const withNotes = contacts.filter((c) => Array.isArray(c.notes) && c.notes.length > 0)

    const results: { id: string; name: string; tags: string[] }[] = []
    const errors: { id: string; name: string; error: string }[] = []

    for (const contact of withNotes) {
      try {
        const tags = await regenerateTagsForContact(
          contact.id,
          {
            name: contact.name,
            role: contact.role,
            company: contact.company,
            sector: contact.sector,
          },
          contact.notes as { summary: string; full_notes: string | null }[]
        )
        results.push({ id: contact.id, name: contact.name, tags })
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
      results,
      error_details: errors,
    })
  } catch (err) {
    console.error('Re-tag all failed:', err)
    return NextResponse.json(
      { error: 'Re-tag all failed', details: String(err) },
      { status: 500 }
    )
  }
}
