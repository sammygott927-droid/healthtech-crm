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

  // Parse JSON fields for company-centric format
  const parsed = (data || []).map((item) => {
    let aiData = { articles: [], synthesis: '', contact_name: '' }
    let emailData = { modular: [], combined: '' }

    try {
      aiData = JSON.parse(item.ai_summary || '{}')
    } catch {
      // Legacy format: plain text summary
      aiData = { articles: [], synthesis: item.ai_summary || '', contact_name: item.headline || '' }
    }

    try {
      emailData = JSON.parse(item.draft_email || '{}')
    } catch {
      // Legacy format: plain text email
      emailData = { modular: [], combined: item.draft_email || '' }
    }

    return {
      id: item.id,
      company: item.company,
      contact_name: aiData.contact_name || item.headline,
      contact_id: item.contact_id,
      relevance: item.relevance,
      articles: aiData.articles || [],
      synthesis: aiData.synthesis || '',
      modular_emails: emailData.modular || [],
      combined_email: emailData.combined || '',
      created_at: item.created_at,
    }
  })

  return NextResponse.json(parsed)
}
