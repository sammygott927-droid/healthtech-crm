import { Resend } from 'resend'

interface ArticleItem {
  headline: string
  url: string
  summary: string
}

interface EmailOption {
  label: string
  full_email: string
}

interface CompanyDigestItem {
  company: string
  contact_name: string
  articles: ArticleItem[]
  synthesis: string
  relevance: string
  email_options: EmailOption[]
}

interface FollowUpContact {
  name: string
  company: string | null
  days_until_due?: number
  days_overdue?: number
  last_contact_date: string | null
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

export async function sendDailyDigest(
  items: CompanyDigestItem[],
  upcoming: FollowUpContact[],
  overdue: FollowUpContact[],
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

  const subject = `Your Daily Brief — ${today} — ${items.length} companies`

  const html = buildEmailHtml(items, upcoming, overdue, today, appUrl)

  const resend = getResend()
  const { data, error } = await resend.emails.send({
    from: 'HealthTech CRM <onboarding@resend.dev>',
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

function buildEmailHtml(
  items: CompanyDigestItem[],
  upcoming: FollowUpContact[],
  overdue: FollowUpContact[],
  dateStr: string,
  appUrl: string
): string {
  const relevanceColor = (r: string) => {
    if (r === 'High') return '#dc2626'
    if (r === 'Medium') return '#d97706'
    return '#6b7280'
  }

  const companyCardsHtml = items.length === 0
    ? '<p style="color: #9ca3af; font-size: 14px;">No news items today.</p>'
    : items.map((item) => {
      const articlesHtml = item.articles.map((a) => `
        <div style="background: #f9fafb; border-radius: 6px; padding: 10px; margin-bottom: 6px;">
          <a href="${escapeHtml(a.url)}" style="font-size: 13px; font-weight: 600; color: #2563eb; text-decoration: none;">${escapeHtml(a.headline)}</a>
          <p style="font-size: 12px; color: #4b5563; margin: 4px 0 0 0;">${escapeHtml(a.summary)}</p>
        </div>
      `).join('')

      const optionsHtml = item.email_options.map((opt) => `
        <div style="background: #eff6ff; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
          <p style="font-size: 11px; font-weight: 700; color: #1e40af; margin: 0 0 6px 0;">${escapeHtml(opt.label)}</p>
          <p style="font-size: 13px; color: #374151; margin: 0; white-space: pre-wrap;">${escapeHtml(opt.full_email)}</p>
        </div>
      `).join('')

      return `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <div style="margin-bottom: 8px;">
            <span style="font-size: 15px; font-weight: 700; color: #111827;">${escapeHtml(item.company)}</span>
            <span style="font-size: 11px; background: ${relevanceColor(item.relevance)}15; color: ${relevanceColor(item.relevance)}; padding: 2px 8px; border-radius: 4px; margin-left: 8px; font-weight: 600;">${item.relevance}</span>
          </div>
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 10px 0;">Contact: ${escapeHtml(item.contact_name)}</p>
          ${articlesHtml}
          <div style="border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
            <p style="font-size: 11px; font-weight: 600; color: #6b7280; margin: 0 0 4px 0;">SYNTHESIS</p>
            <p style="font-size: 13px; color: #374151; margin: 0;">${escapeHtml(item.synthesis)}</p>
          </div>
          <div style="border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
            <p style="font-size: 11px; font-weight: 600; color: #6b7280; margin: 0 0 6px 0;">DRAFT EMAIL OPTIONS</p>
            ${optionsHtml}
          </div>
        </div>
      `
    }).join('')

  const upcomingHtml = upcoming.length === 0
    ? '<p style="color: #9ca3af; font-size: 14px;">No follow-ups due in the next 7 days.</p>'
    : '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">' +
      upcoming.map((c) => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 8px 0; font-weight: 500; color: #111827;">${escapeHtml(c.name)}</td>
          <td style="padding: 8px 0; color: #6b7280;">${escapeHtml(c.company || '')}</td>
          <td style="padding: 8px 0; text-align: right; color: #d97706; font-weight: 500;">${c.days_until_due === 0 ? 'Due today' : `Due in ${c.days_until_due} days`}</td>
        </tr>
      `).join('') +
      '</table>'

  const overdueHtml = overdue.length === 0
    ? '<p style="color: #9ca3af; font-size: 14px;">All caught up!</p>'
    : '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">' +
      overdue.map((c) => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 8px 0; font-weight: 500; color: #111827;">${escapeHtml(c.name)}</td>
          <td style="padding: 8px 0; color: #6b7280;">${escapeHtml(c.company || '')}</td>
          <td style="padding: 8px 0; text-align: right; color: #dc2626; font-weight: 500;">${c.days_overdue} days overdue</td>
        </tr>
      `).join('') +
      '</table>'

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="font-size: 20px; color: #111827; margin: 0 0 4px 0;">Your Daily Brief</h1>
    <p style="font-size: 13px; color: #9ca3af; margin: 0 0 24px 0;">${dateStr}</p>

    <h2 style="font-size: 16px; color: #111827; margin: 0 0 12px 0;">Top Companies</h2>
    ${companyCardsHtml}

    <h2 style="font-size: 16px; color: #111827; margin: 24px 0 12px 0;">Follow-Up Reminders</h2>
    ${upcomingHtml}

    <h2 style="font-size: 16px; color: #111827; margin: 24px 0 12px 0;">Overdue Connections</h2>
    ${overdueHtml}

    <div style="margin-top: 24px; text-align: center;">
      <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">View Dashboard</a>
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
