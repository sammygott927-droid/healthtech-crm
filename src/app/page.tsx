'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface BriefItem {
  id: string
  company: string | null
  headline: string | null
  ai_summary: string | null
  relevance: string | null
  draft_email: string | null
  source_url: string | null
  contact_id: string | null
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
  const [briefs, setBriefs] = useState<BriefItem[]>([])
  const [upcoming, setUpcoming] = useState<FollowUpContact[]>([])
  const [overdue, setOverdue] = useState<FollowUpContact[]>([])
  const [loading, setLoading] = useState(true)
  const [runningBrief, setRunningBrief] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  function copyEmail(id: string, email: string) {
    navigator.clipboard.writeText(email)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
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
            {/* Section 1: Today's Brief */}
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
                <div className="space-y-4">
                  {briefs.slice(0, 5).map((item) => (
                    <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-500">{item.company}</span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${relevanceColor(item.relevance)}`}>
                              {item.relevance}
                            </span>
                          </div>
                          <a
                            href={item.source_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 hover:underline"
                          >
                            {item.headline}
                          </a>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{item.ai_summary}</p>

                      {item.draft_email && (
                        <div className="bg-gray-50 rounded p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-500">Draft Email</span>
                            <button
                              onClick={() => copyEmail(item.id, item.draft_email!)}
                              className="text-xs bg-white border border-gray-300 px-3 py-1 rounded hover:bg-gray-50 text-gray-700"
                            >
                              {copiedId === item.id ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.draft_email}</p>
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
