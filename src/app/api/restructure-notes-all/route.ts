import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { structureSingleNote } from '@/lib/structure-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Backfill per-note AI summary + structured categories for every note that
 * is missing them. This is the maintenance counterpart to the new per-note
 * pipeline introduced in the notes redesign (Task 1).
 */
export async function POST() {
  try {
    // Find notes that have raw content but no AI summary yet
    const { data: notes, error } = await supabase
      .from('notes')
      .select(
        'id, contact_id, raw_notes, summary, full_notes, ai_summary, contacts(name, role, company, sector)'
      )
      .is('ai_summary', null)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!notes || notes.length === 0) {
      return NextResponse.json({
        message: 'No notes need structuring',
        processed: 0,
      })
    }

    const results: { id: string }[] = []
    const errors: { id: string; error: string }[] = []

    for (const note of notes) {
      const rawText =
        note.raw_notes ||
        [note.summary, note.full_notes].filter(Boolean).join('\n\n')

      if (!rawText.trim()) continue

      // contacts is a single object when joined via foreign key — typed loose
      // here because Supabase types it as a relation array.
      const contact = Array.isArray(note.contacts)
        ? note.contacts[0]
        : note.contacts

      if (!contact) continue

      try {
        await structureSingleNote(
          note.id,
          {
            name: contact.name,
            role: contact.role,
            company: contact.company,
            sector: contact.sector,
          },
          rawText
        )
        results.push({ id: note.id })
      } catch (err) {
        errors.push({ id: note.id, error: String(err) })
      }
    }

    return NextResponse.json({
      success: true,
      total_notes_needing_backfill: notes.length,
      processed: results.length,
      errors: errors.length,
      error_details: errors,
    })
  } catch (err) {
    console.error('Restructure-notes-all failed:', err)
    return NextResponse.json(
      { error: 'Restructure failed', details: String(err) },
      { status: 500 }
    )
  }
}
