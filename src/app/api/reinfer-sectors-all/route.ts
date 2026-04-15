import { NextResponse } from 'next/server'
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

// Re-infer a specific niche sector for every contact, using notes as signal.
// Each contact is wrapped in its own try/catch AND a hard timeout so one slow
// or stuck contact can't stop the batch or exhaust the 300s function budget.
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
        // Truncate error message; one bad error can bloat the response
        const msg = String(err).slice(0, 300)
        errors.push({ id: contact.id, name: contact.name, error: msg })
        console.error(`[reinfer-sectors] Failed ${contact.name}:`, err)
        // Continue to next contact — one failure never stops the batch
      }
    }

    return NextResponse.json({
      success: true,
      total_contacts: contacts.length,
      updated,
      skipped,
      errors: errors.length,
      // Only return first 10 error details to keep payload small
      error_details: errors.slice(0, 10),
    })
  } catch (err) {
    // Last-resort catch — always return JSON, never let Next/Vercel return an HTML/text error page
    console.error('[reinfer-sectors] Fatal:', err)
    return NextResponse.json(
      { error: 'Re-infer sectors failed', details: String(err).slice(0, 500) },
      { status: 500 }
    )
  }
}
