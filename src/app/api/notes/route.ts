import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateTagsForNote } from '@/lib/generate-tags'
import { structureSingleNote } from '@/lib/structure-notes'

// Allow up to 60s for the after() background work to finish
export const maxDuration = 60

/**
 * POST /api/notes
 *
 * Accepts a single raw notes blob (any format) and saves it as one
 * conversation card. Returns the inserted row immediately so the UI
 * can render the card instantly. Two background jobs then run inside
 * `after()` so they actually execute on Vercel (a plain fire-and-forget
 * Promise gets killed when the serverless function freezes after the
 * response is sent):
 *   1. Per-note AI structuring (1-2 sentence summary + categorized bullets)
 *   2. Tag generation from the note content
 *
 * Back-compat: still accepts the old { summary, full_notes } shape for
 * any callers that haven't migrated yet (e.g. the import flow).
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

  // Determine the canonical raw text. New flow: raw_notes is the source of
  // truth. Old flow: stitch full_notes onto summary so historical callers
  // keep working.
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

  // Look up contact context for the AI calls (synchronously — cheap)
  const { data: contact } = await supabase
    .from('contacts')
    .select('name, role, company, sector')
    .eq('id', contact_id)
    .single()

  // Auto-update last_contact_date to today (fast, can stay synchronous)
  const today = new Date().toISOString().split('T')[0]
  await supabase
    .from('contacts')
    .update({ last_contact_date: today })
    .eq('id', contact_id)

  // Schedule AI work to run AFTER the response is sent. On Vercel this uses
  // waitUntil() to keep the function alive until both promises settle —
  // unlike a bare fire-and-forget which gets frozen with the function.
  if (contact) {
    after(async () => {
      const startedAt = Date.now()
      console.log(`[notes-after] starting AI jobs for note ${note.id}`)

      const [structResult, tagResult] = await Promise.allSettled([
        structureSingleNote(note.id, contact, rawText),
        generateTagsForNote(contact_id, contact, rawText.slice(0, 200), rawText),
      ])

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      if (structResult.status === 'rejected') {
        console.error(`[notes-after] structureSingleNote failed:`, structResult.reason)
      }
      if (tagResult.status === 'rejected') {
        console.error(`[notes-after] generateTagsForNote failed:`, tagResult.reason)
      }
      console.log(`[notes-after] note ${note.id} jobs done in ${elapsed}s`)
    })
  }

  return NextResponse.json(note)
}
