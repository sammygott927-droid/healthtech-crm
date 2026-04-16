import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateTagsForNote } from '@/lib/generate-tags'
import { structureSingleNote } from '@/lib/structure-notes'

/**
 * POST /api/notes
 *
 * Accepts a single raw notes blob (any format) and saves it as one
 * conversation card. Two background jobs fire after insert:
 *   1. Per-note AI structuring (1-2 sentence summary + categorized bullets)
 *   2. Tag generation from the note content
 *
 * Both run fire-and-forget so the user sees the new card immediately.
 *
 * Back-compat: still accepts the old { summary, full_notes } shape for any
 * callers that haven't migrated yet (e.g. the import flow). When raw_notes
 * is provided we use the new per-note pipeline; otherwise we fall back.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { contact_id } = body
  const rawNotes: string | undefined = body.raw_notes
  const legacySummary: string | undefined = body.summary
  const legacyFullNotes: string | undefined = body.full_notes

  if (!contact_id) {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }

  // Determine the canonical raw text. New flow: raw_notes is the source of truth.
  // Old flow: stitch full_notes onto summary so historical callers keep working.
  const rawText =
    rawNotes?.trim() ||
    [legacySummary, legacyFullNotes].filter(Boolean).join('\n\n').trim()

  if (!rawText) {
    return NextResponse.json(
      { error: 'raw_notes (or legacy summary/full_notes) is required' },
      { status: 400 }
    )
  }

  // Insert the note. ai_summary and ai_structured start null and get
  // populated by the background structuring job.
  const { data: note, error: noteError } = await supabase
    .from('notes')
    .insert({
      contact_id,
      raw_notes: rawText,
      // Populate legacy columns from raw text so any older code that still
      // reads `summary`/`full_notes` keeps rendering something.
      summary: legacySummary || rawText.slice(0, 200),
      full_notes: legacyFullNotes || rawText,
    })
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

  // Look up contact context for the AI calls
  const { data: contact } = await supabase
    .from('contacts')
    .select('name, role, company, sector')
    .eq('id', contact_id)
    .single()

  if (contact) {
    // Background job 1: per-note structuring (writes ai_summary + ai_structured)
    structureSingleNote(note.id, contact, rawText).catch((err) =>
      console.error('Single-note structuring failed:', err)
    )

    // Background job 2: tag generation from this note's content
    generateTagsForNote(contact_id, contact, rawText.slice(0, 200), rawText).catch(
      (err) => console.error('Tag generation from note failed:', err)
    )
  }

  return NextResponse.json(note)
}
