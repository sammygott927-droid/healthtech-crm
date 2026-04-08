'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <div className="flex gap-3">
            <Link
              href="/"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Command Center
            </Link>
            <Link
              href="/import"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Import CSV
            </Link>
            <Link
              href="/contacts/new"
              className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700 text-sm"
            >
              + Add Contact
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search by name or company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-900"
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
              className="border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-900"
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
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 text-gray-900 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('name')}
                >
                  Name{sortIndicator('name')}
                </th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('company')}
                >
                  Company{sortIndicator('company')}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('last_contact_date')}
                >
                  Last Contact{sortIndicator('last_contact_date')}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
                contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/contacts/${c.id}`} className="text-blue-600 hover:underline font-medium">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.company || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.role || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        c.status === 'Active' ? 'bg-green-100 text-green-800' :
                        c.status === 'Warm' ? 'bg-yellow-100 text-yellow-800' :
                        c.status === 'Cold' ? 'bg-blue-100 text-blue-800' :
                        c.status === 'Dormant' ? 'bg-gray-100 text-gray-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {c.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.last_contact_date
                        ? new Date(c.last_contact_date).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tags?.slice(0, 3).map((t, i) => (
                          <span key={i} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs">
                            {t.tag}
                          </span>
                        ))}
                        {c.tags?.length > 3 && (
                          <span className="text-xs text-gray-400">+{c.tags.length - 3}</span>
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
    </div>
  )
}
