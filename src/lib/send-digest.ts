import { Resend } from 'resend'
import { CATEGORY_ORDER, CATEGORY_STYLES, resolveCategory, type Category } from './brief-display'

/* ── Interfaces matching the v2 pipeline output ── */

export interface BriefDigestItem {
  headline: string
  source_url: string
  source_name: string
  so_what: string
  relevance_score: number
  category?: string | null
}

/** Inline-style colors for each category header in the email.
 * Mirrors CATEGORY_STYLES from brief-display.ts but as raw hex (Tailwind
 * classes don't work in HTML email — must be inline style attrs). */
const EMAIL_CATEGORY_COLORS: Record<Category, { label: string; emoji: string; text: string; bg: string; rule: string }> = {
  funding:            { label: 'Funding',            emoji: '💰', text: '#047857', bg: '#ecfdf5', rule: '#a7f3d0' },
  partnership:        { label: 'Partnerships',       emoji: '🤝', text: '#6d28d9', bg: '#faf5ff', rule: '#e9d5ff' },
  market_news:        { label: 'Market news',        emoji: '📰', text: '#92400e', bg: '#fffbeb', rule: '#fde68a' },
  thought_leadership: { label: 'Thought leadership', emoji: '💡', text: '#1d4ed8', bg: '#eff6ff', rule: '#bfdbfe' },
  regulatory:         { label: 'Regulatory',         emoji: '📋', text: '#b91c1c', bg: '#fef2f2', rule: '#fecaca' },
}

export interface ActionDigestItem {
  headline: string
  source_url: string
  contact_id: string | null
  contact_match_reason: string | null
  // Resolved at call-site or from the pipeline
  contact_name?: string
  contact_company?: string
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

/**
 * Send the daily email digest with two sections:
 *   1. Today's Intelligence — one bullet per Daily Brief item
 *   2. Today's Actions — one line per outreach opportunity
 */
export async function sendDailyDigest(
  briefItems: BriefDigestItem[],
  actionItems: ActionDigestItem[],
  appUrl: string
) {
  const userEmail = process.env.USER_EMAIL
  if (!userEmail || userEmail === 'your-email-here') {
    console.log('USER_EMAIL not configured, skipping email send')
    return { skipped: true }
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const subject = `In the Loop — ${today} — ${briefItems.length} stories`

  const html = buildEmailHtml(briefItems, actionItems, today, appUrl)

  const resend = getResend()
  const { data, error } = await resend.emails.send({
    from: 'In the Loop <onboarding@resend.dev>',
    to: [userEmail],
    subject,
    html,
  })

  if (error) {
    console.error('Email send failed:', error)
    return { error: error.message }
  }

  return { success: true, emailId: data?.id }
}

/**
 * Pure HTML composer — exported so the in-app "Preview Today's Digest"
 * button (demo branch) can render the same digest the cron would have
 * sent, without actually shipping email through Resend.
 */
export function buildEmailHtml(
  briefItems: BriefDigestItem[],
  actionItems: ActionDigestItem[],
  dateStr: string,
  appUrl: string
): string {
  // ── Section 1: Today's Intelligence (grouped by category) ──
  const grouped = new Map<Category, BriefDigestItem[]>()
  for (const item of briefItems) {
    const cat = resolveCategory(item.category, { headline: item.headline, so_what: item.so_what })
    const arr = grouped.get(cat) || []
    arr.push(item)
    grouped.set(cat, arr)
  }

  const renderItem = (item: BriefDigestItem) => `
            <li style="margin-bottom: 12px; font-size: 14px; line-height: 1.5; color: #374151;">
              <a href="${esc(item.source_url)}" style="font-weight: 600; color: #2563eb; text-decoration: none;">${esc(item.headline)}</a>
              <span style="color: #6b7280; font-size: 12px;"> — ${esc(item.source_name)}</span>
              <br/>
              <span style="font-size: 13px; color: #4b5563;">${esc(item.so_what)}</span>
            </li>`

  const renderCategorySection = (cat: Category, items: BriefDigestItem[]) => {
    const s = EMAIL_CATEGORY_COLORS[cat]
    return `
        <div style="margin-top: 18px;">
          <div style="border-top: 2px solid ${s.rule}; padding-top: 10px; margin-bottom: 8px;">
            <span style="font-size: 14px; font-weight: 600; color: ${s.text};">${s.emoji} ${s.label}</span>
            <span style="display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 9999px; background: ${s.bg}; color: ${s.text}; font-size: 11px; font-weight: 600;">${items.length}</span>
          </div>
          <ul style="padding-left: 18px; margin: 0;">${items.map(renderItem).join('')}
          </ul>
        </div>`
  }

  const intelligenceHtml =
    briefItems.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">No high-relevance stories today.</p>'
      : CATEGORY_ORDER.filter((c) => (grouped.get(c)?.length || 0) > 0)
          .map((c) => renderCategorySection(c, grouped.get(c)!))
          .join('')

  // ── Section 2: Today's Actions ──
  const actionsHtml =
    actionItems.length === 0
      ? '<p style="color: #9ca3af; font-size: 14px;">No outreach actions today.</p>'
      : '<ul style="padding-left: 18px; margin: 0;">' +
        actionItems
          .map((item) => {
            const contactLabel = item.contact_name
              ? `${esc(item.contact_name)}${item.contact_company ? ` at ${esc(item.contact_company)}` : ''}`
              : '(unknown contact)'
            const reason = item.contact_match_reason
              ? esc(item.contact_match_reason)
              : `re: ${esc(item.headline)}`

            return `
          <li style="margin-bottom: 10px; font-size: 14px; line-height: 1.5; color: #374151;">
            <strong>Reach out to ${contactLabel}</strong> — ${reason}
            <br/>
            <a href="${appUrl}?tab=actions" style="font-size: 12px; color: #2563eb; text-decoration: none;">View in Daily Actions →</a>
          </li>`
          })
          .join('') +
        '</ul>'

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <p style="font-size: 11px; color: #2563eb; margin: 0 0 2px 0; letter-spacing: 0.05em; font-weight: 600; text-transform: uppercase;">In the Loop</p>
    <h1 style="font-size: 20px; color: #111827; margin: 0 0 4px 0;">Your Daily Brief</h1>
    <p style="font-size: 13px; color: #9ca3af; margin: 0 0 24px 0;">${dateStr}</p>

    <h2 style="font-size: 16px; color: #111827; margin: 0 0 12px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">Today's Intelligence</h2>
    ${intelligenceHtml}

    <h2 style="font-size: 16px; color: #111827; margin: 24px 0 12px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">Today's Actions</h2>
    ${actionsHtml}

    <div style="margin-top: 24px; text-align: center;">
      <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">View Dashboard</a>
    </div>
  </div>
</body>
</html>`
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
