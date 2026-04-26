'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import QuickAddModal from '@/components/QuickAddModal'
import { statusBadgeClasses, BADGE_BASE, TAG_PILL, CARD, H1 } from '@/lib/ui-tokens'
import { formatPlainDate } from '@/lib/plain-date'

interface Contact {
  id: string
  name: string
  company: string | null
  role: string | null
  status: string | null
  last_contact_date: string | null
  tags: { tag: string }[]
}

const STATUSES = ['Active', 'Warm', 'Cold', 'Dormant']
const ROLES = ['Operator', 'Investor', 'Consultant']

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showQuickAdd, setShowQuickAdd] = useState(false)

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (roleFilter) params.set('role', roleFilter)
    if (sectorFilter) params.set('sector', sectorFilter)
    params.set('sortBy', sortBy)
    params.set('sortDir', sortDir)

    const res = await fetch(`/api/contacts?${params}`)
    const data = await res.json()
    setContacts(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search, statusFilter, roleFilter, sectorFilter, sortBy, sortDir])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  function handleSort(column: string) {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }

  function sortIndicator(column: string) {
    if (sortBy !== column) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div className="p-8">
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className={H1}>Contacts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Your healthcare network — search, filter, and drill into the details.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/import"
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 text-sm transition-colors"
            >
              Import CSV
            </Link>
            <button
              onClick={() => setShowQuickAdd(true)}
              className="border border-purple-300 text-purple-700 px-4 py-2 rounded-lg font-medium hover:bg-purple-50 text-sm transition-colors inline-flex items-center gap-1.5"
              title="Extract a contact from pasted text or a screenshot"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2 L14 8 L20 8 L15 12 L17 18 L12 14 L7 18 L9 12 L4 8 L10 8 Z" />
              </svg>
              Quick Add
            </button>
            <Link
              href="/contacts/new"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 text-sm transition-colors"
            >
              + Add Contact
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className={`${CARD} p-4 mb-4 flex flex-wrap gap-3 items-end`}>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search by name or company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900"
            >
              <option value="">All</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sector</label>
            <input
              type="text"
              placeholder="e.g. home health"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40 text-gray-900 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th
                  className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  Name{sortIndicator('name')}
                </th>
                <th
                  className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('company')}
                >
                  Company{sortIndicator('company')}
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                  Status
                </th>
                <th
                  className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('last_contact_date')}
                >
                  Last Contact{sortIndicator('last_contact_date')}
                </th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No contacts found.{' '}
                    <Link href="/import" className="text-blue-600 hover:underline">Import a CSV</Link>
                    {' '}or{' '}
                    <Link href="/contacts/new" className="text-blue-600 hover:underline">add one manually</Link>.
                  </td>
                </tr>
              ) : (
                contacts.map((c, idx) => (
                  <tr
                    key={c.id}
                    className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/40 transition-colors`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="text-gray-900 hover:text-blue-700 font-semibold"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.company || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.role || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`${BADGE_BASE} ${statusBadgeClasses(c.status)}`}>
                        {c.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatPlainDate(c.last_contact_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {c.tags?.slice(0, 3).map((t, i) => (
                          <span key={i} className={TAG_PILL}>
                            {t.tag}
                          </span>
                        ))}
                        {c.tags?.length > 3 && (
                          <span className="text-xs text-gray-400 self-center">
                            +{c.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Add modal (Task 10) */}
      {showQuickAdd && <QuickAddModal onClose={() => setShowQuickAdd(false)} />}
    </div>
  )
}
