'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { statusBadgeClasses, BADGE_BASE, CARD, H1 } from '@/lib/ui-tokens'
import { formatPlainDate, todayLocal } from '@/lib/plain-date'

interface OverdueContact {
  id: string
  name: string
  company: string | null
  status: string | null
  last_contact_date: string | null
  follow_up_cadence_days: number
  days_overdue: number
}

// Display order for the per-status sections.
const STATUS_ORDER: Array<'Active' | 'Warm' | 'Cold' | 'Dormant'> = [
  'Active',
  'Warm',
  'Cold',
  'Dormant',
]

export default function ReconnectPage() {
  const [overdue, setOverdue] = useState<OverdueContact[]>([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/follow-ups', { cache: 'no-store' })
      const data = await res.json()
      // API returns { upcoming, overdue } — Reconnect only cares about overdue.
      setOverdue(Array.isArray(data.overdue) ? data.overdue : [])
    } catch (err) {
      console.error('Failed to load follow-ups:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function markAsContacted(id: string) {
    if (marking.has(id)) return
    setMarking((prev) => new Set(prev).add(id))

    // Local-date YYYY-MM-DD (NOT toISOString — that would slide a day in
    // negative-offset zones via the timezone-bug we already squashed for
    // last_contact_date).
    const t = todayLocal()
    const yyyy = t.getFullYear()
    const mm = String(t.getMonth() + 1).padStart(2, '0')
    const dd = String(t.getDate()).padStart(2, '0')
    const todayStr = `${yyyy}-${mm}-${dd}`

    // Optimistic remove from the UI
    setOverdue((prev) => prev.filter((c) => c.id !== id))

    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_contact_date: todayStr }),
      })
      if (!res.ok) {
        // Roll back the optimistic remove on failure
        await load()
      }
    } catch (err) {
      console.error('Mark-as-contacted failed:', err)
      await load()
    } finally {
      setMarking((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // Bucket by status, then sort each bucket by most-overdue first.
  const grouped: Record<string, OverdueContact[]> = {
    Active: [],
    Warm: [],
    Cold: [],
    Dormant: [],
    Other: [],
  }
  for (const c of overdue) {
    const key = STATUS_ORDER.includes(c.status as typeof STATUS_ORDER[number])
      ? (c.status as string)
      : 'Other'
    grouped[key].push(c)
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => b.days_overdue - a.days_overdue)
  }

  const totalOverdue = overdue.length

  return (
    <div className="p-8">
      <div className="w-full">
        <div className="mb-6">
          <h1 className={H1}>Reconnect</h1>
          <p className="text-sm text-gray-500 mt-1">
            Contacts past their follow-up cadence. Grouped by relationship
            status — Active first, since those usually move the needle most.
          </p>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading…</p>
        ) : totalOverdue === 0 ? (
          <div className={`${CARD} p-12 text-center`}>
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 mb-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-base font-medium text-gray-900">No overdue contacts.</p>
            <p className="text-sm text-gray-500 mt-1">
              Every relationship is within its follow-up window. Nice.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {STATUS_ORDER.map((status) => {
              const items = grouped[status] || []
              if (items.length === 0) return null
              return (
                <ReconnectSection
                  key={status}
                  status={status}
                  items={items}
                  marking={marking}
                  onMark={markAsContacted}
                />
              )
            })}
            {grouped.Other.length > 0 && (
              <ReconnectSection
                status="Other"
                items={grouped.Other}
                marking={marking}
                onMark={markAsContacted}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReconnectSection({
  status,
  items,
  marking,
  onMark,
}: {
  status: string
  items: OverdueContact[]
  marking: Set<string>
  onMark: (id: string) => void
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className={`${BADGE_BASE} ${statusBadgeClasses(status)}`}>{status}</span>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          {status} — {items.length} overdue
        </h2>
      </div>
      <div className="space-y-3">
        {items.map((c) => (
          <OverdueCard
            key={c.id}
            contact={c}
            isMarking={marking.has(c.id)}
            onMark={() => onMark(c.id)}
          />
        ))}
      </div>
    </section>
  )
}

function OverdueCard({
  contact,
  isMarking,
  onMark,
}: {
  contact: OverdueContact
  isMarking: boolean
  onMark: () => void
}) {
  return (
    <article
      className={`${CARD} p-5 flex items-center gap-4 hover:shadow-md hover:border-gray-300 transition-all`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/contacts/${contact.id}`}
            className="text-base font-semibold text-gray-900 hover:text-blue-700"
          >
            {contact.name}
          </Link>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 ring-1 ring-inset ring-red-200`}
          >
            {contact.days_overdue}d overdue
          </span>
        </div>
        {contact.company && (
          <p className="text-sm text-gray-600 mt-0.5">{contact.company}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Last contact:{' '}
          <span className="font-medium text-gray-600">
            {formatPlainDate(contact.last_contact_date)}
          </span>{' '}
          · cadence every {contact.follow_up_cadence_days} days
        </p>
      </div>
      <button
        onClick={onMark}
        disabled={isMarking}
        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
      >
        {isMarking ? (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {isMarking ? 'Marking…' : 'Mark as contacted'}
      </button>
    </article>
  )
}
