import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { structureSingleNote } from '@/lib/structure-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Re-runs per-note AI structuring across notes.
 *
 * Modes:
 *   - default (no params): only notes where ai_summary IS NULL
 *   - force=true: every note that has raw content, regardless of existing
 *     ai_summary. Used to recover from a backfill that copied the old
 *     `summary` field into `ai_summary` (e.g. pipe-delimited import text).
 *
 * POST /api/restructure-notes-all          → only missing notes
 * POST /api/restructure-notes-all?force=1  → every note with raw content
 */
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const force =
      url.searchParams.get('force') === '1' ||
      url.searchParams.get('force') === 'true'

    let query = supabase
      .from('notes')
      .select(
        'id, contact_id, raw_notes, summary, full_notes, ai_summary, contacts(name, role, company, sector)'
      )

    if (!force) {
      query = query.is('ai_summary', null)
    }

    const { data: notes, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!notes || notes.length === 0) {
      return NextResponse.json({
        message: force
          ? 'No notes found at all'
          : 'No notes need structuring',
        total: 0,
        processed: 0,
      })
    }

    const results: { id: string }[] = []
    const errors: { id: string; error: string }[] = []

    // Run notes in parallel batches of 5 to keep total time bounded
    const BATCH = 5
    for (let i = 0; i < notes.length; i += BATCH) {
      const slice = notes.slice(i, i + BATCH)
      await Promise.all(
        slice.map(async (note) => {
          const rawText =
            note.raw_notes ||
            [note.summary, note.full_notes].filter(Boolean).join('\n\n')

          if (!rawText.trim()) return

          // Supabase types `contacts` as a relation that may be array or single
          const contact = Array.isArray(note.contacts)
            ? note.contacts[0]
            : note.contacts

          if (!contact) return

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
    }

    return NextResponse.json({
      success: true,
      mode: force ? 'force' : 'missing-only',
      total: notes.length,
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
