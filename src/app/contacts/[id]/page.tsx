'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Tag {
  id: string
  tag: string
  source: string
}

interface Note {
  id: string
  summary: string
  full_notes: string | null
  created_at: string
}

interface Contact {
  id: string
  name: string
  role: string | null
  company: string | null
  sector: string | null
  referral_source: string | null
  status: string | null
  next_step: string | null
  email: string | null
  phone: string | null
  follow_up_cadence_days: number
  last_contact_date: string | null
  tags: Tag[]
  notes: Note[]
}

const STATUSES = ['Active', 'Warm', 'Cold', 'Dormant']

function getFollowUpLabel(lastContact: string | null, cadenceDays: number): { text: string; color: string } {
  if (!lastContact) return { text: 'No contact date set', color: 'text-gray-400' }
  const last = new Date(lastContact)
  const due = new Date(last.getTime() + cadenceDays * 24 * 60 * 60 * 1000)
  const today = new Date()
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { text: `Overdue by ${Math.abs(diffDays)} days`, color: 'text-red-600' }
  if (diffDays === 0) return { text: 'Due today', color: 'text-yellow-600' }
  return { text: `Due in ${diffDays} days`, color: 'text-green-600' }
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [newTag, setNewTag] = useState('')
  const [editingStatus, setEditingStatus] = useState(false)
  const [editingNextStep, setEditingNextStep] = useState(false)
  const [editingCadence, setEditingCadence] = useState(false)
  const [nextStepDraft, setNextStepDraft] = useState('')
  const [cadenceDraft, setCadenceDraft] = useState(60)

  // Note form state
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteSummary, setNoteSummary] = useState('')
  const [noteFullText, setNoteFullText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  const fetchContact = useCallback(async () => {
    const res = await fetch(`/api/contacts/${id}`)
    const data = await res.json()
    if (!res.ok) return
    setContact(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchContact()
  }, [fetchContact])

  async function updateField(field: string, value: unknown) {
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    fetchContact()
  }

  async function addTag() {
    if (!newTag.trim()) return
    await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: id, tag: newTag.trim() }),
    })
    setNewTag('')
    fetchContact()
  }

  async function removeTag(tagId: string) {
    await fetch('/api/tags', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tagId }),
    })
    fetchContact()
  }

  async function saveNote() {
    if (!noteSummary.trim()) return
    setNoteSaving(true)
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: id,
        summary: noteSummary.trim(),
        full_notes: noteFullText.trim() || null,
      }),
    })
    setNoteSummary('')
    setNoteFullText('')
    setShowNoteForm(false)
    setNoteSaving(false)
    fetchContact()
  }

  if (loading || !contact) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  const followUp = getFollowUpLabel(contact.last_contact_date, contact.follow_up_cadence_days)

  return (
    <div className="p-8">
      <div className="max-w-3xl">
        <Link href="/contacts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Contacts
        </Link>

        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
          <p className="text-gray-600 mt-1">
            {contact.role && <span>{contact.role}</span>}
            {contact.role && contact.company && <span> at </span>}
            {contact.company && <span className="font-medium">{contact.company}</span>}
          </p>

          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div>
              <span className="text-gray-500">Sector:</span>{' '}
              <span className="text-gray-900">{contact.sector || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Email:</span>{' '}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">{contact.email}</a>
              ) : '—'}
            </div>
            <div>
              <span className="text-gray-500">Phone:</span>{' '}
              <span className="text-gray-900">{contact.phone || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Referral:</span>{' '}
              <span className="text-gray-900">{contact.referral_source || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Last Contact:</span>{' '}
              <span className="text-gray-900">
                {contact.last_contact_date
                  ? new Date(contact.last_contact_date).toLocaleDateString()
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Status, Next Step, Follow-up Cadence */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-28">Status:</span>
            {editingStatus ? (
              <select
                value={contact.status || 'Active'}
                onChange={(e) => {
                  updateField('status', e.target.value)
                  setEditingStatus(false)
                }}
                onBlur={() => setEditingStatus(false)}
                autoFocus
                className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="text-sm text-gray-900 hover:bg-gray-100 px-2 py-1 rounded"
              >
                {contact.status || 'Active'} ✎
              </button>
            )}
          </div>

          {/* Next Step */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-28">Next Step:</span>
            {editingNextStep ? (
              <div className="flex gap-2 flex-1">
                <input
                  type="text"
                  value={nextStepDraft}
                  onChange={(e) => setNextStepDraft(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 text-gray-900"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateField('next_step', nextStepDraft)
                      setEditingNextStep(false)
                    }
                  }}
                />
                <button
                  onClick={() => { updateField('next_step', nextStepDraft); setEditingNextStep(false) }}
                  className="text-sm bg-blue-600 text-white px-3 py-1 rounded"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setNextStepDraft(contact.next_step || ''); setEditingNextStep(true) }}
                className="text-sm text-gray-900 hover:bg-gray-100 px-2 py-1 rounded"
              >
                {contact.next_step || 'None set'} ✎
              </button>
            )}
          </div>

          {/* Follow-up Cadence */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-28">Follow-up:</span>
            {editingCadence ? (
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={cadenceDraft}
                  onChange={(e) => setCadenceDraft(parseInt(e.target.value) || 0)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-20 text-gray-900"
                  autoFocus
                />
                <span className="text-sm text-gray-500">days</span>
                <button
                  onClick={() => { updateField('follow_up_cadence_days', cadenceDraft); setEditingCadence(false) }}
                  className="text-sm bg-blue-600 text-white px-3 py-1 rounded"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setCadenceDraft(contact.follow_up_cadence_days); setEditingCadence(true) }}
                  className="text-sm text-gray-900 hover:bg-gray-100 px-2 py-1 rounded"
                >
                  Every {contact.follow_up_cadence_days} days ✎
                </button>
                <span className={`text-sm font-medium ${followUp.color}`}>{followUp.text}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Tags</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {contact.tags.length === 0 && <span className="text-sm text-gray-400">No tags yet</span>}
            {contact.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2.5 py-1 rounded text-sm">
                {t.tag}
                <button
                  onClick={() => removeTag(t.id)}
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
              placeholder="Add a tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 text-gray-900 placeholder-gray-400"
            />
            <button
              onClick={addTag}
              disabled={!newTag.trim()}
              className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Notes</h2>
            <button
              onClick={() => setShowNoteForm(!showNoteForm)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700"
            >
              + Add Note
            </button>
          </div>

          {showNoteForm && (
            <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
              <input
                type="text"
                placeholder="Summary (required)"
                value={noteSummary}
                onChange={(e) => setNoteSummary(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm mb-2 text-gray-900 placeholder-gray-400"
                autoFocus
              />
              <textarea
                placeholder="Full notes (optional)"
                value={noteFullText}
                onChange={(e) => setNoteFullText(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm mb-2 text-gray-900 placeholder-gray-400"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowNoteForm(false)}
                  className="text-sm text-gray-600 px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNote}
                  disabled={!noteSummary.trim() || noteSaving}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {noteSaving ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {contact.notes.length === 0 && (
              <p className="text-sm text-gray-400">No notes yet. Add one to start tracking interactions.</p>
            )}
            {contact.notes.map((n) => (
              <div key={n.id} className="border-l-2 border-gray-200 pl-4 py-1">
                <p className="text-sm font-medium text-gray-900">{n.summary}</p>
                {n.full_notes && <p className="text-sm text-gray-600 mt-1">{n.full_notes}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(n.created_at).toLocaleDateString()} at{' '}
                  {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
