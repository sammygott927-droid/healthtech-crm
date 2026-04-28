import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { dedupeActionsByContact } from '@/lib/dedupe-actions'
import { buildEmailHtml } from '@/lib/send-digest'

export const dynamic = 'force-dynamic'

const MAX_BRIEF_SIZE = 20
const MIN_BRIEF_RELEVANCE = 6

/**
 * GET /api/preview-digest
 *
 * TEMPORARY (feature/grouped-email-format only): renders the same email
 * digest body the cron would have sent, using today's already-stored
 * daily_briefs rows. Does not call Claude, does not send email.
 *
 * Default returns rendered HTML (so you can visit the URL in a browser
 * and see the email exactly as it would arrive). Pass ?format=json to
 * get the structured payload instead.
 *
 * To be removed from main after the grouped-email-format change is
 * merged. Lives permanently on the demo branch.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const format = url.searchParams.get('format') || 'html'

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

  const { data: rows, error } = await supabase
    .from('daily_briefs')
    .select('id, headline, source_url, source_name, pub_date, so_what, relevance_score, category, contact_match_score, contact_id, contact_match_reason, status')
    .gte('created_at', startOfDay)
    .order('relevance_score', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const allRows = rows || []

  const briefItems = allRows
    .filter((r) => (r.relevance_score as number) >= MIN_BRIEF_RELEVANCE)
    .slice(0, MAX_BRIEF_SIZE)
    .map((r) => ({
      headline: r.headline as string,
      source_url: (r.source_url as string) || '',
      source_name: (r.source_name as string) || '',
      so_what: (r.so_what as string) || '',
      relevance_score: r.relevance_score as number,
      category: (r.category as string | null) ?? null,
    }))

  const actionCandidates = allRows.filter(
    (r) =>
      r.contact_match_score !== null &&
      (r.contact_match_score as number) >= 7 &&
      r.contact_id
  )

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

  type Row = (typeof actionCandidates)[number]
  const deduped = dedupeActionsByContact(
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

  const actions: { row: Row; contact: typeof contactMap[string] | undefined }[] = []
  let coldCount = 0
  for (const candidate of deduped) {
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
    headline: row.headline as string,
    source_url: (row.source_url as string) || '',
    contact_id: (row.contact_id as string) || null,
    contact_match_reason: (row.contact_match_reason as string) || null,
    contact_name: contact?.name,
    contact_company: contact?.company ?? undefined,
  }))

  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const appUrl = new URL('/', request.url).toString()
  const html = buildEmailHtml(briefItems, actionItems, dateStr, appUrl)

  if (format === 'json') {
    return NextResponse.json({
      html,
      subject: `In the Loop — ${dateStr} — ${briefItems.length} stories`,
      date: dateStr,
      brief_count: briefItems.length,
      action_count: actionItems.length,
      has_run: allRows.length > 0,
    })
  }

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
