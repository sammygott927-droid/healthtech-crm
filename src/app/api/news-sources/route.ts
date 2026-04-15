import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — list all sources, newest-first
export async function GET() {
  const { data, error } = await supabase
    .from('news_sources')
    .select('id, name, url, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data || [])
}

// POST — create a new source. Body: { name, url }
export async function POST(request: NextRequest) {
  let body: { name?: unknown; url?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  // Basic URL shape check — don't need to actually fetch it; daily-brief tolerates failures
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return NextResponse.json({ error: 'URL must be http(s)' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('news_sources')
    .insert({ name, url })
    .select('id, name, url, created_at')
    .single()

  if (error) {
    // Unique violation on url → 409
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A source with this URL already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
