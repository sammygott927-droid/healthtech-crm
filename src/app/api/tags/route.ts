import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { contact_id, tag } = await request.json()

  if (!contact_id || !tag) {
    return NextResponse.json({ error: 'contact_id and tag are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tags')
    .insert({ contact_id, tag: tag.trim(), source: 'manual' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json()

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { error } = await supabase.from('tags').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
