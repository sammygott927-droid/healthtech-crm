'use client'

import { useState } from 'react'
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
    last_contact_date: new Date().toISOString().split('T')[0],
  })

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')

    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create contact')
      setSaving(false)
      return
    }

    const contact = await res.json()
    router.push(`/contacts/${contact.id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-xl">
        <Link href="/contacts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Contacts
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Contact</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
              placeholder="Full name"
              autoFocus
            />
          </div>

          {/* Role + Company (side by side) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => updateField('role', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
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
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
                placeholder="Company name"
              />
            </div>
          </div>

          {/* Sector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sector / Industry</label>
            <input
              type="text"
              value={form.sector}
              onChange={(e) => updateField('sector', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
              placeholder="e.g., home health, value-based care, pre-seed healthtech"
            />
          </div>

          {/* Email + Phone (side by side) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {/* Referral Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Referral Source</label>
            <input
              type="text"
              value={form.referral_source}
              onChange={(e) => updateField('referral_source', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
              placeholder="How you met — warm intro, cold LinkedIn, McKinsey, etc."
            />
          </div>

          {/* Status + Last Contact Date (side by side) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => updateField('status', e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
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
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>

          {/* Next Step */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Step</label>
            <input
              type="text"
              value={form.next_step}
              onChange={(e) => updateField('next_step', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900"
              placeholder='e.g., "Send follow-up after JPM"'
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Contact'}
            </button>
            <Link
              href="/contacts"
              className="px-4 py-2 rounded font-medium text-gray-600 hover:bg-gray-100 text-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
