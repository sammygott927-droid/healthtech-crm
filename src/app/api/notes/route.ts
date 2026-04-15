import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateTagsForNote } from '@/lib/generate-tags'
import { structureNotesForContact } from '@/lib/structure-notes'

export async function POST(request: NextRequest) {
  const { contact_id, summary, full_notes } = await request.json()

  if (!contact_id || !summary) {
    return NextResponse.json({ error: 'contact_id and summary are required' }, { status: 400 })
  }

  // Insert the note
  const { data: note, error: noteError } = await supabase
    .from('notes')
    .insert({ contact_id, summary, full_notes: full_notes || null })
    .select()
    .single()

  if (noteError) {
    return NextResponse.json({ error: noteError.message }, { status: 500 })
  }

  // Auto-update last_contact_date to today
  const today = new Date().toISOString().split('T')[0]
  await supabase
    .from('contacts')
    .update({ last_contact_date: today })
    .eq('id', contact_id)

  // Auto-generate tags from note content
  const { data: contact } = await supabase
    .from('contacts')
    .select('name, role, company, sector')
    .eq('id', contact_id)
    .single()

  if (contact) {
    generateTagsForNote(contact_id, contact, summary, full_notes || null)
      .catch((err) => console.error('Tag generation from note failed:', err))

    // Fire-and-forget: restructure notes view across all notes for this contact
    ;(async () => {
      const { data: allNotes } = await supabase
        .from('notes')
        .select('summary, full_notes, created_at')
        .eq('contact_id', contact_id)
      if (!allNotes) return
      await structureNotesForContact(contact_id, contact, allNotes)
    })().catch((err) => console.error('Note structuring failed:', err))
  }

  return NextResponse.json(note)
}
