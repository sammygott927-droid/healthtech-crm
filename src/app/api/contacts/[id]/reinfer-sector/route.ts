import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { inferSectorForContact } from '@/lib/infer-sector'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Re-infer sector for a single contact (Task 3).
 *
 * Uses the same web-search Claude pipeline as the batch endpoint, but
 * scoped to one contact so the UI can offer a one-click "Re-infer"
 * button next to the sector field.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id, name, role, company, sector, notes(summary, full_notes)')
      .eq('id', id)
      .single()

    if (error || !contact) {
      return NextResponse.json(
        { error: error?.message || 'Contact not found' },
        { status: 404 }
      )
    }

    const newSector = await inferSectorForContact(
      contact.id,
      {
        name: contact.name,
        role: contact.role,
        company: contact.company,
        sector: contact.sector,
      },
      (contact.notes as { summary: string; full_notes: string | null }[]) || []
    )

    if (newSector === null) {
      return NextResponse.json({
        success: true,
        updated: false,
        sector: contact.sector,
        message: 'Could not determine a sector — existing value preserved',
      })
    }

    return NextResponse.json({
      success: true,
      updated: true,
      sector: newSector,
      previous_sector: contact.sector,
    })
  } catch (err) {
    console.error(`[reinfer-sector ${id}] Failed:`, err)
    return NextResponse.json(
      { error: 'Sector inference failed', details: String(err).slice(0, 500) },
      { status: 500 }
    )
  }
}
