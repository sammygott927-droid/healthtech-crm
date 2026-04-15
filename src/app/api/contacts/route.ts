import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const status = url.searchParams.get('status') || ''
  const role = url.searchParams.get('role') || ''
  const sector = url.searchParams.get('sector') || ''
  const sortBy = url.searchParams.get('sortBy') || 'name'
  const sortDir = url.searchParams.get('sortDir') === 'desc' ? false : true

  let query = supabase
    .from('contacts')
    .select('*, tags(tag)')

  if (search) {
    query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%`)
  }
  if (status) {
    query = query.eq('status', status)
  }
  if (role) {
    query = query.eq('role', role)
  }
  if (sector) {
    query = query.ilike('sector', `%${sector}%`)
  }

  const sortColumn = ['name', 'company', 'last_contact_date'].includes(sortBy) ? sortBy : 'name'
  query = query.order(sortColumn, { ascending: sortDir, nullsFirst: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Set cadence default based on role
  const cadence = body.role === 'Consultant' ? 120 : 60

  const contactData = {
    name: body.name.trim(),
    role: body.role || null,
    company: body.company?.trim() || null,
    sector: body.sector?.trim() || null,
    referral_source: body.referral_source?.trim() || null,
    status: body.status || 'Active',
    next_step: body.next_step?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    follow_up_cadence_days: cadence,
    last_contact_date: body.last_contact_date || new Date().toISOString().split('T')[0],
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert(contactData)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // If the form submitted suggested/manual tags, persist them now.
  // Tags are marked 'auto-import' (AI-suggested) — user already curated them on the form.
  if (Array.isArray(body.tags) && body.tags.length > 0) {
    const tagRows = body.tags
      .map((t: unknown) => (typeof t === 'string' ? t.trim() : ''))
      .filter((t: string) => t.length > 0)
      .map((tag: string) => ({
        contact_id: data.id,
        tag,
        source: 'auto-import',
      }))

    if (tagRows.length > 0) {
      await supabase.from('tags').insert(tagRows)
    }
  }

  return NextResponse.json(data, { status: 201 })
}
