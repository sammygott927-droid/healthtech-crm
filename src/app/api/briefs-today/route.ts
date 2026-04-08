import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

  const { data, error } = await supabase
    .from('daily_briefs')
    .select('*')
    .gte('created_at', startOfDay)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const parsed = (data || []).map((item) => {
    let aiData = { articles: [], synthesis: '', contact_name: '' }
    let emailData: { options?: { label: string; full_email: string }[]; modular?: string[]; combined?: string } = {}

    try {
      aiData = JSON.parse(item.ai_summary || '{}')
    } catch {
      aiData = { articles: [], synthesis: item.ai_summary || '', contact_name: item.headline || '' }
    }

    try {
      emailData = JSON.parse(item.draft_email || '{}')
    } catch {
      emailData = {}
    }

    // Support new options format and legacy modular/combined format
    const emailOptions = emailData.options || []

    return {
      id: item.id,
      company: item.company,
      contact_name: aiData.contact_name || item.headline,
      contact_id: item.contact_id,
      relevance: item.relevance,
      articles: aiData.articles || [],
      synthesis: aiData.synthesis || '',
      email_options: emailOptions,
      created_at: item.created_at,
    }
  })

  return NextResponse.json(parsed)
}
