'use client'

import { useEffect, useState } from 'react'

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

export interface EditableWatchlistEntry {
  id: string
  company: string
  type: WatchlistType | null
  sector: string | null
  stage: string | null
  description: string | null
  reason: string | null
  notes: string | null
}

interface Props {
  entry: EditableWatchlistEntry
  onClose: () => void
  onSaved: () => void
}

export default function EditWatchlistModal({ entry, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    company: entry.company || '',
    type: entry.type || '',
    sector: entry.sector || '',
    stage: entry.stage || '',
    description: entry.description || '',
    reason: entry.reason || '',
    notes: entry.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  function update<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function save() {
    if (!form.company.trim()) {
      setError('Company is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        company: form.company.trim(),
        type: form.type || null,
        sector: form.sector.trim() || null,
        stage: form.stage.trim() || null,
        description: form.description.trim() || null,
        reason: form.reason.trim() || null,
        notes: form.notes.trim() || null,
      }
      const res = await fetch(`/api/watchlist/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Save failed (${res.status})`)
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit watchlist entry</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
            <input
              type="text"
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => update('type', e.target.value as WatchlistType | '')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white"
              >
                <option value="">—</option>
                {WATCHLIST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
              <input
                type="text"
                value={form.stage}
                onChange={(e) => update('stage', e.target.value)}
                placeholder="e.g. Seed, Series B, Growth, Public"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
            <input
              type="text"
              value={form.sector}
              onChange={(e) => update('sector', e.target.value)}
              placeholder="e.g. home health, value-based primary care, Medicare Advantage plan"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="One-line: what does this company do?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason tracked</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => update('reason', e.target.value)}
              placeholder="Why is this on the watchlist?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Investment thesis, deal history, relevant people, competitive dynamics…"
              rows={5}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
