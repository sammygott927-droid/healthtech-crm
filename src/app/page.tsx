'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface ArticleItem {
  headline: string
  url: string
  summary: string
}

interface EmailOption {
  label: string
  full_email: string
}

interface CompanyBrief {
  id: string
  company: string | null
  contact_name: string | null
  contact_id: string | null
  relevance: string | null
  articles: ArticleItem[]
  synthesis: string | null
  email_options: EmailOption[]
  created_at: string
}

interface FollowUpContact {
  id: string
  name: string
  company: string | null
  last_contact_date: string | null
  days_until_due?: number
  days_overdue?: number
}

export default function HomePage() {
  const [briefs, setBriefs] = useState<CompanyBrief[]>([])
  const [upcoming, setUpcoming] = useState<FollowUpContact[]>([])
  const [overdue, setOverdue] = useState<FollowUpContact[]>([])
  const [loading, setLoading] = useState(true)
  const [runningBrief, setRunningBrief] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [briefsRes, followUpsRes] = await Promise.all([
      fetch('/api/briefs-today'),
      fetch('/api/follow-ups'),
    ])
    const briefsData = await briefsRes.json()
    const followUpsData = await followUpsRes.json()

    setBriefs(Array.isArray(briefsData) ? briefsData : [])
    setUpcoming(followUpsData.upcoming || [])
    setOverdue(followUpsData.overdue || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function runBrief() {
    setRunningBrief(true)
    await fetch('/api/daily-brief', { method: 'POST' })
    await fetchData()
    setRunningBrief(false)
  }

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function toggleEmail(id: string) {
    setExpandedEmails(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const relevanceColor = (r: string | null) => {
    if (r === 'High') return 'bg-red-100 text-red-700'
    if (r === 'Medium') return 'bg-yellow-100 text-yellow-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/contacts"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Contacts
            </Link>
            <Link
              href="/import"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Import
            </Link>
            <Link
              href="/settings"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Settings
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading...</p>
        ) : (
          <>
            {/* Section 1: Today's Brief — Company Cards */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Today&apos;s Brief</h2>
                <button
                  onClick={runBrief}
                  disabled={runningBrief}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {runningBrief ? 'Running...' : 'Run Brief Now'}
                </button>
              </div>

              {briefs.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No brief items yet today. Click &quot;Run Brief Now&quot; to generate.
                </p>
              ) : (
                <div className="space-y-5">
                  {briefs.map((item) => (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-5">
                      {/* Company header */}
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-base font-semibold text-gray-900">{item.company}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${relevanceColor(item.relevance)}`}>
                          {item.relevance}
                        </span>
                      </div>

                      {/* Contact name */}
                      {item.contact_name && (
                        <p className="text-xs text-gray-500 mb-3">
                          Contact{item.contact_name.includes(',') ? 's' : ''}: {item.contact_id ? (
                            <Link href={`/contacts/${item.contact_id}`} className="text-blue-600 hover:underline">
                              {item.contact_name}
                            </Link>
                          ) : item.contact_name}
                        </p>
                      )}

                      {/* Articles list */}
                      {item.articles.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {item.articles.map((article, i) => (
                            <div key={i} className="bg-gray-50 rounded p-3">
                              <a
                                href={article.url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-blue-600 hover:underline"
                              >
                                {article.headline}
                              </a>
                              <p className="text-xs text-gray-600 mt-1">{article.summary}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Synthesis paragraph */}
                      {item.synthesis && (
                        <div className="border-t border-gray-100 pt-3 mb-3">
                          <p className="text-xs font-medium text-gray-500 mb-1">Synthesis</p>
                          <p className="text-sm text-gray-700">{item.synthesis}</p>
                        </div>
                      )}

                      {/* Draft Email Options (collapsible) */}
                      {item.email_options.length > 0 && (
                        <div className="border-t border-gray-100 pt-3">
                          <button
                            onClick={() => toggleEmail(item.id)}
                            className="text-xs font-medium text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1"
                          >
                            {expandedEmails.has(item.id) ? '▼' : '▶'} Draft Emails ({item.email_options.length} option{item.email_options.length > 1 ? 's' : ''})
                          </button>

                          {expandedEmails.has(item.id) && (
                            <div className="space-y-3">
                              {item.email_options.map((option, i) => (
                                <div key={i} className="bg-blue-50 rounded-lg p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-blue-800">{option.label}</span>
                                    <button
                                      onClick={() => copyText(`${item.id}-opt-${i}`, option.full_email)}
                                      className="text-xs bg-white border border-blue-200 px-3 py-1 rounded hover:bg-blue-50 text-blue-700 font-medium"
                                    >
                                      {copiedId === `${item.id}-opt-${i}` ? 'Copied!' : 'Copy'}
                                    </button>
                                  </div>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{option.full_email}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 2: Follow-Up Reminders */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Follow-Up Reminders</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-gray-400">No follow-ups due in the next 7 days.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {upcoming.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/contacts/${c.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-sm text-gray-500 ml-2">{c.company}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-yellow-600">
                          {c.days_until_due === 0 ? 'Due today' : `Due in ${c.days_until_due} days`}
                        </span>
                        <p className="text-xs text-gray-400">
                          Last: {c.last_contact_date ? new Date(c.last_contact_date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 3: Overdue Connections */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Overdue Connections</h2>
              {overdue.length === 0 ? (
                <p className="text-sm text-gray-400">All caught up! No overdue connections.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {overdue.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/contacts/${c.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-sm text-gray-500 ml-2">{c.company}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-red-600">
                          {c.days_overdue} days overdue
                        </span>
                        <p className="text-xs text-gray-400">
                          Last: {c.last_contact_date ? new Date(c.last_contact_date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
