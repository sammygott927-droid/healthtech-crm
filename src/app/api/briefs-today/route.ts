import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * GET /api/briefs-today
 *
 * Returns two arrays from today's daily_briefs rows:
 *   brief:   all articles with relevance_score >= 6, ranked desc (news feed)
 *   actions: top 5 contact-matched articles, ranked by composite score
 *
 * Also returns `has_run` so the UI knows whether to show "Run Brief Now".
 */
export async function GET() {
  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

  const { data, error } = await supabase
    .from('daily_briefs')
    .select('id, headline, source_url, source_name, pub_date, so_what, relevance_tag, relevance_score, contact_match_score, contact_id, contact_match_reason, draft_email, signal_boost, status, created_at')
    .gte('created_at', startOfDay)
    .order('relevance_score', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data || []

  // Brief tab: relevance_score >= 6
  const brief = rows
    .filter((r) => (r.relevance_score as number) >= 6)
    .map((r) => ({
      id: r.id,
      headline: r.headline,
      source_url: r.source_url,
      source_name: r.source_name,
      pub_date: r.pub_date,
      so_what: r.so_what,
      relevance_tag: r.relevance_tag,
      relevance_score: r.relevance_score,
    }))

  // Actions tab: contact_match_score >= 7, resolve contact name via join
  // We need contact names for the action cards. Fetch matched contacts.
  const actionCandidates = rows.filter(
    (r) => r.contact_match_score !== null && (r.contact_match_score as number) >= 7 && r.contact_id
  )

  // Fetch contact info for matched contacts
  const contactIds = [...new Set(actionCandidates.map((r) => r.contact_id as string))]
  let contactMap: Record<string, { name: string; company: string | null; status: string | null }> = {}

  if (contactIds.length > 0) {
    const { data: contactRows } = await supabase
      .from('contacts')
      .select('id, name, company, status')
      .in('id', contactIds)

    for (const c of contactRows || []) {
      contactMap[c.id as string] = {
        name: c.name as string,
        company: c.company as string | null,
        status: c.status as string | null,
      }
    }
  }

  // Rank: relevance*2 + contact_match + status_boost
  const ranked = actionCandidates
    .map((r) => {
      const contact = contactMap[r.contact_id as string]
      const statusBoost = contact?.status === 'Active' ? 3 : contact?.status === 'Warm' ? 2 : 0
      const rank =
        (r.relevance_score as number) * 2 +
        (r.contact_match_score as number) +
        statusBoost
      return { row: r, contact, rank, status: contact?.status ?? null }
    })
    .sort((a, b) => b.rank - a.rank)

  // Max 1 Cold, only if match >= 9
  const actions: typeof ranked = []
  let coldCount = 0
  for (const item of ranked) {
    if (actions.length >= 5) break
    if (item.status === 'Cold') {
      if (coldCount >= 1) continue
      if ((item.row.contact_match_score as number) < 9) continue
      coldCount++
    }
    actions.push(item)
  }

  const actionItems = actions.map(({ row, contact }) => ({
    id: row.id,
    headline: row.headline,
    source_url: row.source_url,
    source_name: row.source_name,
    so_what: row.so_what,
    relevance_score: row.relevance_score,
    contact_match_score: row.contact_match_score,
    contact_id: row.contact_id,
    contact_name: contact?.name ?? null,
    contact_company: contact?.company ?? null,
    contact_status: contact?.status ?? null,
    contact_match_reason: row.contact_match_reason,
    draft_email: row.draft_email,
    status: row.status,
  }))

  return NextResponse.json({
    brief,
    actions: actionItems,
    has_run: rows.length > 0,
  })
}
