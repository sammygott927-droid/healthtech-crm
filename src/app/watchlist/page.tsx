'use client'

import { useCallback, useEffect, useState } from 'react'
import Toast, { type ToastVariant } from '@/components/Toast'

interface WatchlistEntry {
  id: string
  company: string
  sector: string | null
  reason: string | null
  auto_added: boolean
  created_at: string
}

export default function WatchlistPage() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'company' | 'sector' | 'created_at'>('company')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Add form
  const [newCompany, setNewCompany] = useState('')
  const [newSector, setNewSector] = useState('')
  const [newReason, setNewReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Action buttons
  const [syncing, setSyncing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // Per-row Re-infer state (set of row ids currently re-inferring)
  const [reinferringIds, setReinferringIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    params.set('sortBy', sortBy)
    params.set('sortDir', sortDir)
    const res = await fetch(`/api/watchlist?${params}`)
    const data = await res.json()
    setEntries(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [search, sortBy, sortDir])

  useEffect(() => {
    load()
  }, [load])

  function handleSort(col: 'company' | 'sector' | 'created_at') {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  function sortIndicator(col: string) {
    if (sortBy !== col) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    const company = newCompany.trim()
    if (!company) return
    setAdding(true)
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company,
          sector: newSector.trim() || undefined,
          reason: newReason.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAddError(data.error || 'Failed to add')
        return
      }
      setEntries((prev) => [data, ...prev])
      setNewCompany('')
      setNewSector('')
      setNewReason('')
    } finally {
      setAdding(false)
    }
  }

  async function reinferSector(id: string, company: string) {
    if (reinferringIds.has(id)) return
    setReinferringIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/watchlist/${id}/reinfer-sector`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToast({
          message: data.error || `Failed for ${company} (${res.status})`,
          variant: 'error',
        })
        return
      }
      if (data.updated) {
        setToast({
          message: `Sector updated to: ${data.sector}`,
          variant: 'success',
        })
        // Update the local row in place so the new sector shows immediately
        setEntries((prev) =>
          prev.map((row) => (row.id === id ? { ...row, sector: data.sector } : row))
        )
      } else {
        setToast({
          message: data.message || `Could not determine a sector for ${company}`,
          variant: 'info',
        })
      }
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : `Re-infer failed for ${company}`,
        variant: 'error',
      })
    } finally {
      setReinferringIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleDelete(id: string, company: string) {
    if (!confirm(`Remove "${company}" from the watchlist?`)) return
    const prev = entries
    setEntries((e) => e.filter((x) => x.id !== id))
    const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setEntries(prev)
      const data = await res.json().catch(() => ({}))
      alert(`Delete failed: ${data.error || 'Unknown error'}`)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setActionMsg(null)
    try {
      const res = await fetch('/api/watchlist/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setActionMsg(`Sync failed: ${data.error || 'Unknown error'}`)
        return
      }
      setActionMsg(`Synced from contacts: ${data.added} added, ${data.skipped} already tracked.`)
      await load()
    } finally {
      setSyncing(false)
    }
  }

  async function handleExtract() {
    setExtracting(true)
    setActionMsg(null)
    try {
      const res = await fetch('/api/watchlist/extract', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setActionMsg(`Extract failed: ${data.error || 'Unknown error'}`)
        return
      }
      const names = (data.candidates || [])
        .map((c: { company: string }) => c.company)
        .slice(0, 5)
        .join(', ')
      setActionMsg(
        data.added > 0
          ? `AI added ${data.added} companies from notes${names ? `: ${names}${data.candidates.length > 5 ? '…' : ''}` : ''}.`
          : 'AI found no new companies worth tracking.'
      )
      await load()
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync from Contacts'}
            </button>
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="border border-purple-300 text-purple-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-purple-50 disabled:opacity-50"
              title="Use AI to find companies mentioned in your notes"
            >
              {extracting ? 'Extracting…' : 'Extract from Notes (AI)'}
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Companies tracked in the daily brief even when no contact is associated.
        </p>

        {actionMsg && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 text-sm">
            {actionMsg}
          </div>
        )}

        {/* Add form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <form onSubmit={handleAdd} className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr 3fr auto' }}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Company *</label>
              <input
                type="text"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="e.g. Devoted Health"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Sector</label>
              <input
                type="text"
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                placeholder="e.g. Medicare Advantage"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
              <input
                type="text"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Why track this company?"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={adding || !newCompany.trim()}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {adding ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </form>
          {addError && <div className="mt-2 text-xs text-red-600">{addError}</div>}
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Search company, sector, or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('company')}
                >
                  Company{sortIndicator('company')}
                </th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('sector')}
                >
                  Sector{sortIndicator('sector')}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Reason</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort('created_at')}
                >
                  Added{sortIndicator('created_at')}
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No companies on your watchlist yet. Add one above, sync from contacts, or extract from notes.
                  </td>
                </tr>
              ) : (
                entries.map((e) => {
                  const isReinferring = reinferringIds.has(e.id)
                  return (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{e.company}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{e.sector || '—'}</span>
                        <button
                          onClick={() => reinferSector(e.id, e.company)}
                          disabled={isReinferring}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1.5 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="Re-infer sector using web search"
                        >
                          {isReinferring ? (
                            <>
                              <svg
                                className="animate-spin h-3 w-3"
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                              </svg>
                              Re-inferring…
                            </>
                          ) : (
                            'Re-infer'
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{e.reason || '—'}</td>
                    <td className="px-4 py-3">
                      {e.auto_added ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Auto
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          Manual
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(e.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(e.id, e.company)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast notifications (Task 4) */}
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
