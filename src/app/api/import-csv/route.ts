import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { generateTagsForImport } from '@/lib/generate-tags'

const COLUMN_MAP: Record<string, string> = {
  name: 'name',
  full_name: 'name',
  role: 'role',
  company: 'company',
  organization: 'company',
  sector: 'sector',
  industry: 'sector',
  referral_source: 'referral_source',
  referral: 'referral_source',
  source: 'referral_source',
  status: 'status',
  next_step: 'next_step',
  next_steps: 'next_step',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  last_contact_date: 'last_contact_date',
  last_contacted: 'last_contact_date',
  notes: 'notes',
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function getCadence(role: string | undefined): number {
  if (!role) return 60
  const r = role.trim().toLowerCase()
  if (r === 'consultant') return 120
  return 60
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const text = await file.text()
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json({ error: 'Failed to parse CSV', details: parsed.errors }, { status: 400 })
    }

    // Map CSV headers to our fields
    const rawHeaders = parsed.meta.fields || []
    const headerMap: Record<string, string> = {}
    for (const h of rawHeaders) {
      const normalized = normalizeHeader(h)
      if (COLUMN_MAP[normalized]) {
        headerMap[h] = COLUMN_MAP[normalized]
      }
    }

    const rows = parsed.data as Record<string, string>[]
    let imported = 0
    const errors: string[] = []

    for (const row of rows) {
      // Build contact object from mapped columns
      const mapped: Record<string, string> = {}
      for (const [csvCol, dbCol] of Object.entries(headerMap)) {
        if (row[csvCol]?.trim()) {
          mapped[dbCol] = row[csvCol].trim()
        }
      }

      if (!mapped.name) {
        errors.push(`Skipped row: missing name`)
        continue
      }

      const notesText = mapped.notes
      delete mapped.notes

      // Insert contact
      const contactData = {
        ...mapped,
        follow_up_cadence_days: getCadence(mapped.role),
        last_contact_date: mapped.last_contact_date || null,
      }

      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert(contactData)
        .select('id')
        .single()

      if (contactError) {
        errors.push(`Failed to import ${mapped.name}: ${contactError.message}`)
        continue
      }

      // Insert initial note if present
      if (notesText && contact) {
        await supabase.from('notes').insert({
          contact_id: contact.id,
          summary: notesText.substring(0, 100),
          full_notes: notesText,
        })
      }

      // Auto-generate tags via AI
      if (contact) {
        generateTagsForImport(contact.id, {
          name: mapped.name,
          role: mapped.role,
          company: mapped.company,
          sector: mapped.sector,
        }).catch((err) => console.error(`Tag generation failed for ${mapped.name}:`, err))
      }

      imported++
    }

    return NextResponse.json({
      success: true,
      imported,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Import failed', details: String(err) },
      { status: 500 }
    )
  }
}
