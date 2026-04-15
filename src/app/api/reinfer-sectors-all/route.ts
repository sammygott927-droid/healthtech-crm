import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Hard cap per contact. Web search can stall; don't let one contact eat the whole budget.
const PER_CONTACT_TIMEOUT_MS = 45_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// Re-infer sectors for a slice of contacts. Accepts ?offset=N&limit=M query
// params so the client can drive batched processing without hitting the
// per-function 300s Vercel budget. Contacts are ordered by created_at ASC
// so batches are stable across calls.
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
    const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10) || 20
    const limit = Math.min(Math.max(rawLimit, 1), 50) // clamp 1..50

    // Get total count first so the client can compute batch progress
    const { count: totalCount, error: countErr } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 })
    }

    // Fetch just this slice, ordered for stability
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, notes(summary, full_notes)')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const total = totalCount || 0

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({
        success: true,
        total,
        offset,
        limit,
        batch_size: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        done: true,
      })
    }

    let updated = 0
    let skipped = 0
    const errors: { id: string; name: string; error: string }[] = []

    for (const contact of contacts) {
      try {
        const newSector = await withTimeout(
          inferSectorForContact(
            contact.id,
            {
              name: contact.name,
              role: contact.role,
              company: contact.company,
              sector: contact.sector,
            },
            (contact.notes as { summary: string; full_notes: string | null }[]) || []
          ),
          PER_CONTACT_TIMEOUT_MS,
          `Sector inference for ${contact.name}`
        )

        if (newSector === null) {
          skipped++
          console.log(`[reinfer-sectors] Skipped ${contact.name} (UNKNOWN)`)
        } else {
          updated++
          console.log(`[reinfer-sectors] Updated ${contact.name}: ${contact.sector || '(none)'} → ${newSector}`)
        }
      } catch (err) {
        const msg = String(err).slice(0, 300)
        errors.push({ id: contact.id, name: contact.name, error: msg })
        console.error(`[reinfer-sectors] Failed ${contact.name}:`, err)
      }
    }

    const nextOffset = offset + contacts.length
    const done = nextOffset >= total

    return NextResponse.json({
      success: true,
      total,
      offset,
      limit,
      batch_size: contacts.length,
      next_offset: done ? null : nextOffset,
      done,
      updated,
      skipped,
      errors: errors.length,
      error_details: errors.slice(0, 10),
    })
  } catch (err) {
    console.error('[reinfer-sectors] Fatal:', err)
    return NextResponse.json(
      { error: 'Re-infer sectors failed', details: String(err).slice(0, 500) },
      { status: 500 }
    )
  }
}
