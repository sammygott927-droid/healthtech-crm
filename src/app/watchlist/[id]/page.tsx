'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Toast, { type ToastVariant } from '@/components/Toast'
import EditWatchlistModal, { type EditableWatchlistEntry } from '@/components/EditWatchlistModal'

const WATCHLIST_TYPES = [
  'Fund',
  'Startup',
  'Growth Stage',
  'Incubator',
  'Health System',
  'Payer',
  'Consulting',
  'Other',
] as const

type WatchlistType = (typeof WATCHLIST_TYPES)[number]

const TYPE_BADGE: Record<WatchlistType, string> = {
  Fund: 'bg-emerald-100 text-emerald-800',
  Startup: 'bg-sky-100 text-sky-800',
  'Growth Stage': 'bg-indigo-100 text-indigo-800',
  Incubator: 'bg-amber-100 text-amber-800',
  'Health System': 'bg-rose-100 text-rose-800',
  Payer: 'bg-violet-100 text-violet-800',
  Consulting: 'bg-orange-100 text-orange-800',
  Other: 'bg-gray-100 text-gray-700',
}

interface RelatedContact {
  id: string
  name: string
  role: string | null
  company: string | null
  status: string | null
  sector: string | null
  matched_on: 'company' | 'notes'
}

interface RecentArticle {
  id: string
  headline: string
  source_url: string | null
  source_name: string | null
  pub_date: string | null
  so_what: string | null
  relevance_tag: string | null
  relevance_score: number
  created_at: string
}

interface WatchlistDetail {
  id: string
  company: string
  type: WatchlistType | null
  sector: string | null
  stage: string | null
  description: string | null
  reason: string | null
  notes: string | null
  auto_added: boolean
  created_at: string
  related_contacts: RelatedContact[]
  recent_articles: RecentArticle[]
}

export default function WatchlistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [entry, setEntry] = useState<WatchlistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [showEditModal, setShowEditModal] = useState(false)
  const [reinferringType, setReinferringType] = useState(false)
  const [reinferringSector, setReinferringSector] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null)

  const fetchEntry = useCallback(async () => {
    const res = await fetch(`/api/watchlist/${id}`, { cache: 'no-store' })
    if (res.status === 404) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const data = await res.json()
    if (!res.ok) {
      setLoading(false)
      return
    }
    setEntry(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchEntry()
  }, [fetchEntry])

  async function reinferType() {
    if (reinferringType) return
    setReinferringType(true)
    try {
      const res = await fetch(`/api/watchlist/${id}/reinfer-type`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToast({ message: data.error || `Failed (${res.status})`, variant: 'error' })
        return
      }
      setToast({ message: `Type updated to: ${data.type}`, variant: 'success' })
      await fetchEntry()
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Re-infer failed',
        variant: 'error',
      })
    } finally {
      setReinferringType(false)
    }
  }

  async function reinferSector() {
    if (reinferringSector) return
    setReinferringSector(true)
    try {
      const res = await fetch(`/api/watchlist/${id}/reinfer-sector`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToast({ message: data.error || `Failed (${res.status})`, variant: 'error' })
        return
      }
      if (data.updated) {
        setToast({ message: `Sector updated to: ${data.sector}`, variant: 'success' })
        await fetchEntry()
      } else {
        setToast({
          message: data.message || 'Could not determine a sector',
          variant: 'info',
        })
      }
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Re-infer failed',
        variant: 'error',
      })
    } finally {
      setReinferringSector(false)
    }
  }

  async function handleDelete() {
    if (!entry) return
    if (!confirm(`Remove "${entry.company}" from the watchlist?`)) return
    const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/watchlist')
    } else {
      setToast({ message: 'Delete failed', variant: 'error' })
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-400">Loading…</div>
  }
  if (notFound || !entry) {
    return (
      <div className="p-8">
        <Link href="/watchlist" className="text-sm text-blue-600 hover:underline">
          ← Back to Watchlist
        </Link>
        <p className="mt-8 text-gray-500">Watchlist entry not found.</p>
      </div>
    )
  }

  const statusColor = (s: string | null) => {
    if (s === 'Active') return 'bg-green-100 text-green-800'
    if (s === 'Warm') return 'bg-yellow-100 text-yellow-800'
    if (s === 'Cold') return 'bg-blue-100 text-blue-800'
    return 'bg-gray-100 text-gray-600'
  }

  const editable: EditableWatchlistEntry = {
    id: entry.id,
    company: entry.company,
    type: entry.type,
    sector: entry.sector,
    stage: entry.stage,
    description: entry.description,
    reason: entry.reason,
    notes: entry.notes,
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl">
        <Link href="/watchlist" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Watchlist
        </Link>

        {/* Header card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4 relative">
          <button
            onClick={() => setShowEditModal(true)}
            className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Edit watchlist entry"
            title="Edit watchlist entry"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>

          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{entry.company}</h1>
            {entry.type && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[entry.type]}`}
              >
                {entry.type}
              </span>
            )}
            {entry.auto_added ? (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                Auto-added
              </span>
            ) : (
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                Manual
              </span>
            )}
          </div>

          {entry.description && (
            <p className="text-sm text-gray-700 mb-4">{entry.description}</p>
          )}

          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500">Type:</span>
              <span className="text-gray-900">{entry.type || '—'}</span>
              <button
                onClick={reinferType}
                disabled={reinferringType}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1.5 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Re-infer type"
              >
                {reinferringType ? (
                  <>
                    <Spinner />
                    …
                  </>
                ) : (
                  'Re-infer'
                )}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500">Sector:</span>
              <span className="text-gray-900">{entry.sector || '—'}</span>
              <button
                onClick={reinferSector}
                disabled={reinferringSector}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1.5 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Re-infer sector using web search"
              >
                {reinferringSector ? (
                  <>
                    <Spinner />
                    Re-inferring…
                  </>
                ) : (
                  'Re-infer'
                )}
              </button>
            </div>
            <div>
              <span className="text-gray-500">Stage:</span>{' '}
              <span className="text-gray-900">{entry.stage || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Added:</span>{' '}
              <span className="text-gray-900">{new Date(entry.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Reason + Notes */}
        {(entry.reason || entry.notes) && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4 space-y-4">
            {entry.reason && (
              <div>
                <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                  Reason tracked
                </h3>
                <p className="text-sm text-gray-900">{entry.reason}</p>
              </div>
            )}
            {entry.notes && (
              <div>
                <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                  Notes
                </h3>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{entry.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Related contacts */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Related contacts
            {entry.related_contacts.length > 0 && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                {entry.related_contacts.length}
              </span>
            )}
          </h2>
          {entry.related_contacts.length === 0 ? (
            <p className="text-sm text-gray-400">
              No contacts linked to this company yet — they&apos;ll appear here once you add a contact at{' '}
              <span className="font-medium text-gray-700">{entry.company}</span> or mention the company in a note.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {entry.related_contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="block border border-gray-200 rounded-lg p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-900">{c.name}</span>
                    {c.status && (
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor(c.status)}`}>
                        {c.status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">
                    {c.role && <span>{c.role}</span>}
                    {c.role && c.company && <span> · </span>}
                    {c.company && <span>{c.company}</span>}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1 italic">
                    {c.matched_on === 'company'
                      ? 'Works at this company'
                      : 'Mentioned in notes'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent news */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Recent news
            {entry.recent_articles.length > 0 && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                {entry.recent_articles.length}
              </span>
            )}
          </h2>
          {entry.recent_articles.length === 0 ? (
            <p className="text-sm text-gray-400">
              No articles mentioning{' '}
              <span className="font-medium text-gray-700">{entry.company}</span> have been picked
              up by the daily brief yet.
            </p>
          ) : (
            <div className="space-y-3">
              {entry.recent_articles.map((a) => (
                <div
                  key={a.id}
                  className="border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={a.source_url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-blue-600 hover:underline leading-snug"
                      >
                        {a.headline}
                      </a>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        {a.source_name && <span>{a.source_name}</span>}
                        {a.pub_date && (
                          <>
                            <span>·</span>
                            <span>{formatDate(a.pub_date)}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>relevance {a.relevance_score}/10</span>
                      </div>
                    </div>
                    {a.relevance_tag && (
                      <span className="flex-shrink-0 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                        {a.relevance_tag}
                      </span>
                    )}
                  </div>
                  {a.so_what && (
                    <p className="text-sm text-gray-700 mt-2">{a.so_what}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleDelete}
            className="text-xs text-red-600 hover:text-red-800"
          >
            Remove from watchlist
          </button>
        </div>
      </div>

      {showEditModal && (
        <EditWatchlistModal
          entry={editable}
          onClose={() => setShowEditModal(false)}
          onSaved={() => fetchEntry()}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}
