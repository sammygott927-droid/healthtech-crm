'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ROLES = ['Operator', 'Investor', 'Consultant']
const STATUSES = ['Active', 'Warm', 'Cold', 'Dormant']

export default function NewContactPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    role: '',
    company: '',
    sector: '',
    referral_source: '',
    status: 'Active',
    next_step: '',
    email: '',
    phone: '',
    last_contact_date: '',
    initial_notes: '',
  })

  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const [customTag, setCustomTag] = useState('')
  const [loadingTags, setLoadingTags] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Debounced tag suggestions whenever company/role/sector/notes change
  useEffect(() => {
    const { company, role, sector, initial_notes, name } = form

    // Only fetch if we have enough context
    if (!company.trim() && !role.trim() && !initial_notes.trim()) {
      setSuggestedTags([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setLoadingTags(true)
      try {
        const res = await fetch('/api/suggest-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, company, sector, notes: initial_notes }),
        })
        const data = await res.json()
        if (Array.isArray(data.tags)) {
          // Merge with existing suggestions — don't overwrite tags the user may have deleted
          setSuggestedTags((prev) => {
            const prevLower = new Set(prev.map(t => t.toLowerCase()))
            const newOnes = data.tags.filter((t: string) => !prevLower.has(t.toLowerCase()))
            return [...prev, ...newOnes]
          })
        }
      } catch (err) {
        console.error('Tag suggestion failed:', err)
      } finally {
        setLoadingTags(false)
      }
    }, 800)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [form.company, form.role, form.sector, form.initial_notes, form.name])

  function removeTag(tag: string) {
    setSuggestedTags((prev) => prev.filter((t) => t !== tag))
  }

  function addCustomTag() {
    const trimmed = customTag.trim()
    if (!trimmed) return
    if (suggestedTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      setCustomTag('')
      return
    }
    setSuggestedTags((prev) => [...prev, trimmed])
    setCustomTag('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')

    const payload = {
      ...form,
      tags: suggestedTags,
    }

    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create contact')
      setSaving(false)
      return
    }

    const contact = await res.json()

    // If there's an initial note, save it as a real note on the contact.
    // The new POST /api/notes pipeline takes the raw blob and runs AI
    // summary + structuring + tag generation in the background.
    if (form.initial_notes.trim()) {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          raw_notes: form.initial_notes.trim(),
        }),
      })
    }

    router.push(`/contacts/${contact.id}`)
  }

  return (
    <div className="p-8">
      <div className="max-w-xl">
        <Link href="/contacts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Contacts
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Contact</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="Full name"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => updateField('role', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              >
                <option value="">Select...</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => updateField('company', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                placeholder="Company name"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sector / Industry</label>
            <input
              type="text"
              value={form.sector}
              onChange={(e) => updateField('sector', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="e.g., home health, value-based care, pre-seed healthtech"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Initial Notes</label>
            <p className="text-xs text-gray-400 mb-1">How you met, thesis areas, topics discussed. Helps generate specific tags.</p>
            <textarea
              value={form.initial_notes}
              onChange={(e) => updateField('initial_notes', e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="e.g., Met at JPM. Focus is VBC partnerships with Medicare Advantage plans, particularly in pulmonary rehab..."
            />
          </div>

          {/* Auto-suggested Tags */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Tags</label>
              {loadingTags && <span className="text-xs text-gray-400">Generating...</span>}
            </div>
            <p className="text-xs text-gray-400 mb-2">
              AI-suggested tags appear as you fill in the fields above. Remove any you don&apos;t want.
            </p>

            <div className="flex flex-wrap gap-2 mb-2 min-h-[32px]">
              {suggestedTags.length === 0 && !loadingTags && (
                <span className="text-xs text-gray-400 italic">No tags yet — start typing role, company, or notes.</span>
              )}
              {suggestedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2.5 py-1 rounded text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-purple-400 hover:text-purple-700 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomTag()
                  }
                }}
                placeholder="Add a custom tag..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
              />
              <button
                type="button"
                onClick={addCustomTag}
                disabled={!customTag.trim()}
                className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Referral Source</label>
            <input
              type="text"
              value={form.referral_source}
              onChange={(e) => updateField('referral_source', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder="How you met — warm intro, cold LinkedIn, McKinsey, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => updateField('status', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Contact Date</label>
              <input
                type="date"
                value={form.last_contact_date}
                onChange={(e) => updateField('last_contact_date', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Step</label>
            <input
              type="text"
              value={form.next_step}
              onChange={(e) => updateField('next_step', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              placeholder='e.g., "Send follow-up after JPM"'
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Add Contact'}
            </button>
            <Link
              href="/contacts"
              className="px-4 py-2 rounded-lg font-medium text-gray-600 hover:bg-gray-100 text-center transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
