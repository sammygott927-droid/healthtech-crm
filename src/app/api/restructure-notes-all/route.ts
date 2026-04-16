import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { structureSingleNote } from '@/lib/structure-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Re-runs per-note AI structuring across the notes table.
 *
 * Modes:
 *   - default (no params): only notes where ai_summary IS NULL
 *   - force=true: every note that has raw content, regardless of existing
 *     ai_summary. Used to recover from a backfill that copied the old
 *     `summary` field (e.g. pipe-delimited import text) into ai_summary.
 *
 * Querying strategy: fetch notes and contacts in two separate calls and
 * join in memory. Embedded relation selects can silently return null on
 * the joined side, which would cause us to skip every note. This avoids
 * that failure mode.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    const url = new URL(request.url)
    const force =
      url.searchParams.get('force') === '1' ||
      url.searchParams.get('force') === 'true'

    console.log(`[restructure-all] starting (mode=${force ? 'force' : 'missing-only'})`)

    // 1. Fetch notes
    let notesQuery = supabase
      .from('notes')
      .select('id, contact_id, raw_notes, summary, full_notes, ai_summary')

    if (!force) {
      notesQuery = notesQuery.is('ai_summary', null)
    }

    const { data: notes, error: notesErr } = await notesQuery

    if (notesErr) {
      console.error('[restructure-all] notes query failed:', notesErr)
      return NextResponse.json(
        { error: `Notes query failed: ${notesErr.message}`, total: 0, processed: 0 },
        { status: 500 }
      )
    }

    const notesList = notes || []
    console.log(`[restructure-all] fetched ${notesList.length} notes`)

    if (notesList.length === 0) {
      return NextResponse.json({
        success: true,
        mode: force ? 'force' : 'missing-only',
        message: force ? 'No notes in database' : 'No notes need structuring',
        total: 0,
        processed: 0,
        errors: 0,
      })
    }

    // 2. Fetch the contacts those notes belong to (one query, in memory join)
    const contactIds = Array.from(new Set(notesList.map((n) => n.contact_id)))
    const { data: contacts, error: contactsErr } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector')
      .in('id', contactIds)

    if (contactsErr) {
      console.error('[restructure-all] contacts query failed:', contactsErr)
      return NextResponse.json(
        {
          error: `Contacts query failed: ${contactsErr.message}`,
          total: notesList.length,
          processed: 0,
        },
        { status: 500 }
      )
    }

    const contactsList = contacts || []
    console.log(`[restructure-all] fetched ${contactsList.length} contacts`)

    const contactById = new Map(contactsList.map((c) => [c.id, c]))

    const results: { id: string }[] = []
    const errors: { id: string; error: string }[] = []
    const skipped: { id: string; reason: string }[] = []

    // 3. Run AI in parallel batches of 5 to keep total time bounded
    const BATCH = 5
    for (let i = 0; i < notesList.length; i += BATCH) {
      const slice = notesList.slice(i, i + BATCH)
      await Promise.all(
        slice.map(async (note) => {
          const rawText =
            note.raw_notes ||
            [note.summary, note.full_notes].filter(Boolean).join('\n\n')

          if (!rawText.trim()) {
            skipped.push({ id: note.id, reason: 'no raw content' })
            return
          }

          const contact = contactById.get(note.contact_id)
          if (!contact) {
            skipped.push({ id: note.id, reason: 'contact not found' })
            return
          }

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
        })
      )
      console.log(
        `[restructure-all] processed ${Math.min(i + BATCH, notesList.length)}/${notesList.length}`
      )
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(
      `[restructure-all] done in ${elapsed}s — processed=${results.length}, skipped=${skipped.length}, errors=${errors.length}`
    )

    return NextResponse.json({
      success: true,
      mode: force ? 'force' : 'missing-only',
      total: notesList.length,
      processed: results.length,
      skipped: skipped.length,
      errors: errors.length,
      elapsed_seconds: Number(elapsed),
      skipped_details: skipped.slice(0, 20),
      error_details: errors.slice(0, 20),
    })
  } catch (err) {
    console.error('[restructure-all] crashed:', err)
    return NextResponse.json(
      { error: 'Restructure failed', details: String(err), total: 0, processed: 0 },
      { status: 500 }
    )
  }
}
