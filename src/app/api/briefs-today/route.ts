import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { dedupeActionsByContact } from '@/lib/dedupe-actions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/briefs-today
 *
 * Returns two arrays from today's daily_briefs rows:
 *   brief:   all articles with relevance_score >= 6, ranked desc (news feed)
 *   actions: top 5 contact-matched articles, ranked by composite score,
 *            with at most ONE card per contact (Task 7 dedup)
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
  const actionCandidates = rows.filter(
    (r) =>
      r.contact_match_score !== null &&
      (r.contact_match_score as number) >= 7 &&
      r.contact_id
  )

  // Fetch contact info for matched contacts
  const contactIds = [...new Set(actionCandidates.map((r) => r.contact_id as string))]
  const contactMap: Record<string, { name: string; company: string | null; status: string | null }> = {}

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

  // ─── Task 7: deduplicate by contact ───
  // Multiple stored articles can match the same contact with score >= 7.
  // Keep only the highest-ranked card per contact so each contact appears
  // at most once in the Actions tab today.
  type Row = (typeof actionCandidates)[number]
  const dedupedCandidates = dedupeActionsByContact(
    actionCandidates.map((r) => {
      const contact = contactMap[r.contact_id as string]
      return {
        item: r as Row,
        contact_id: r.contact_id as string,
        relevance_score: r.relevance_score as number,
        contact_match_score: r.contact_match_score as number,
        status: contact?.status ?? null,
      }
    })
  )

  // Apply Cold cap (max 1 Cold, only if score >= 9) on top of the dedupe.
  const actions: { row: Row; contact: typeof contactMap[string] | undefined }[] = []
  let coldCount = 0
  for (const candidate of dedupedCandidates) {
    if (actions.length >= 5) break
    const row = candidate.item
    const contact = contactMap[row.contact_id as string]
    if (contact?.status === 'Cold') {
      if (coldCount >= 1) continue
      if ((row.contact_match_score as number) < 9) continue
      coldCount++
    }
    actions.push({ row, contact })
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
