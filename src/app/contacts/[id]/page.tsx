'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import MaskedField from '@/components/MaskedField'
import EditContactModal from '@/components/EditContactModal'
import Toast, { type ToastVariant } from '@/components/Toast'
import { statusBadgeClasses, BADGE_BASE, TAG_PILL, CARD, H1 } from '@/lib/ui-tokens'
import { parsePlainDate, formatPlainDate, todayLocal, daysBetween } from '@/lib/plain-date'

interface Tag {
  id: string
  tag: string
  source: string
}

interface Note {
  id: string
  raw_notes: string | null
  ai_summary: string | null
  ai_structured: Record<string, string[]> | null
  // Legacy fields (still returned for back-compat with old rows)
  summary: string | null
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
  next_step_date: string | null
  email: string | null
  phone: string | null
  follow_up_cadence_days: number
  last_contact_date: string | null
  notes_summary: string | null
  notes_structured: Record<string, string[]> | null
  tags: Tag[]
  notes: Note[]
}

const NOTE_CATEGORY_ORDER = [
  'How we met',
  'Areas of interest',
  'Advice given',
  'Key takeaways',
  'Next steps',
  'Miscellaneous',
]

const STATUSES = ['Active', 'Warm', 'Cold', 'Dormant']

function getFollowUpLabel(lastContact: string | null, cadenceDays: number): { text: string; color: string } {
  if (!lastContact) return { text: 'No contact date set', color: 'text-gray-400' }
  // Parse the YYYY-MM-DD plain date as local midnight (no UTC shift) so the
  // cadence math doesn't slide a day around timezone boundaries.
  const last = parsePlainDate(lastContact)
  if (!last) return { text: 'No contact date set', color: 'text-gray-400' }
  const due = new Date(last.getFullYear(), last.getMonth(), last.getDate() + cadenceDays)
  const diffDays = daysBetween(todayLocal(), due)

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

  // Note form state — single textarea, AI handles the rest in the background.
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteRaw, setNoteRaw] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  // Per-note "show raw notes" toggle — keyed by note id
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(new Set())

  // Edit contact modal
  const [showEditModal, setShowEditModal] = useState(false)

  // Re-infer sector
  const [reinferringSector, setReinferringSector] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null)
  // Shown while we poll for sector post-create (background inference still running)
  const [pollingForSector, setPollingForSector] = useState(false)

  async function reinferSector() {
    if (reinferringSector) return
    setReinferringSector(true)
    try {
      const res = await fetch(`/api/contacts/${id}/reinfer-sector`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setToast({
          message: data.error || `Failed (${res.status})`,
          variant: 'error',
        })
        return
      }
      if (data.updated) {
        setToast({
          message: `Sector updated to: ${data.sector}`,
          variant: 'success',
        })
        await fetchContact()
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

  const fetchContact = useCallback(async () => {
    const res = await fetch(`/api/contacts/${id}`, { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) return
    setContact(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchContact()
  }, [fetchContact])

  // Auto-poll for sector when it's missing but the contact has a company.
  // This catches the post-create flow where the POST /api/contacts route
  // kicked off sector inference via after() and the Vercel function is
  // still running it in the background. Polls every 3s for up to 40s,
  // stops as soon as sector becomes non-null or the limit hits.
  useEffect(() => {
    if (!contact) return
    if (contact.sector) return // already have one
    if (!contact.company) return // nothing to infer from

    let cancelled = false
    const started = Date.now()
    const TIMEOUT_MS = 40_000
    const INTERVAL_MS = 3000

    setPollingForSector(true)

    const poll = async () => {
      while (!cancelled && Date.now() - started < TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
        if (cancelled) return
        try {
          const r = await fetch(`/api/contacts/${id}`, { cache: 'no-store' })
          if (!r.ok) continue
          const data = await r.json()
          if (data.sector) {
            if (!cancelled) {
              setContact(data)
              setPollingForSector(false)
            }
            return
          }
        } catch {
          // ignore transient errors and keep polling
        }
      }
      if (!cancelled) setPollingForSector(false)
    }
    poll()

    return () => {
      cancelled = true
      setPollingForSector(false)
    }
    // Only start a new poll when we first observe a contact with a missing
    // sector — re-running on every setContact would create infinite loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, contact?.sector, contact?.company, id])

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
    if (!noteRaw.trim()) return
    setNoteSaving(true)

    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: id,
        raw_notes: noteRaw.trim(),
      }),
    })
    const inserted = res.ok ? await res.json().catch(() => null) : null
    const newNoteId = inserted?.id

    setNoteRaw('')
    setShowNoteForm(false)
    setNoteSaving(false)
    await fetchContact()

    // Poll up to 30s, stopping as soon as the new note has an ai_summary.
    // The background AI job typically finishes in 5-15s on Vercel.
    if (newNoteId) {
      const start = Date.now()
      const TIMEOUT_MS = 30_000
      const INTERVAL_MS = 2000
      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
        try {
          const r = await fetch(`/api/contacts/${id}`)
          if (!r.ok) continue
          const data = await r.json()
          setContact(data)
          const target = data.notes?.find((n: Note) => n.id === newNoteId)
          if (target?.ai_summary) {
            // Done — AI summary populated
            return
          }
        } catch {
          // Ignore transient errors and keep polling
        }
      }
    }
  }

  function toggleRaw(noteId: string) {
    setExpandedRaw((prev) => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }

  if (loading || !contact) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  const followUp = getFollowUpLabel(contact.last_contact_date, contact.follow_up_cadence_days)

  return (
    <div className="p-8">
      <div className="w-full">
        <Link href="/contacts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
          ← Back to Contacts
        </Link>

        {/* Header */}
        <div className={`${CARD} p-6 mb-4 relative`}>
          <button
            onClick={() => setShowEditModal(true)}
            className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Edit contact"
            title="Edit contact"
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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className={H1}>{contact.name}</h1>
            {contact.status && (
              <span className={`${BADGE_BASE} ${statusBadgeClasses(contact.status)}`}>
                {contact.status}
              </span>
            )}
          </div>
          <p className="text-gray-600 mt-1">
            {contact.role && <span>{contact.role}</span>}
            {contact.role && contact.company && <span> at </span>}
            {contact.company && <span className="font-medium">{contact.company}</span>}
          </p>

          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-500">Sector:</span>
              <span className="text-gray-900">
                {contact.sector ? (
                  contact.sector
                ) : pollingForSector ? (
                  <span className="inline-flex items-center gap-1 text-gray-400 italic">
                    <svg
                      className="animate-spin h-3 w-3"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Inferring…
                  </span>
                ) : (
                  '—'
                )}
              </span>
              <button
                onClick={reinferSector}
                disabled={reinferringSector}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1.5 py-0.5 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Re-infer sector using web search"
              >
                {reinferringSector ? (
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
            <div>
              <span className="text-gray-500">Email:</span>{' '}
              <MaskedField value={contact.email} as="mailto" />
            </div>
            <div>
              <span className="text-gray-500">Phone:</span>{' '}
              <MaskedField value={contact.phone} as="tel" className="text-gray-900" />
            </div>
            <div>
              <span className="text-gray-500">Referral:</span>{' '}
              <span className="text-gray-900">{contact.referral_source || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">Last Contact:</span>{' '}
              <span className="text-gray-900">
                {formatPlainDate(contact.last_contact_date)}
              </span>
            </div>
          </div>
        </div>

        {/* Status, Next Step, Follow-up Cadence */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4 space-y-4">
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
                className="text-sm text-gray-900 hover:bg-gray-100 px-2 py-1 rounded text-left"
              >
                {contact.next_step || 'None set'} ✎
                {contact.next_step_date && (
                  <span className="ml-2 text-xs text-gray-500">
                    by {formatPlainDate(contact.next_step_date)}
                  </span>
                )}
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
        <div className={`${CARD} p-6 mb-4`}>
          <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-3">
            Tags
          </h2>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {contact.tags.length === 0 && (
              <span className="text-sm text-gray-400">No tags yet</span>
            )}
            {contact.tags.map((t) => (
              <span key={t.id} className={TAG_PILL}>
                {t.tag}
                <button
                  onClick={() => removeTag(t.id)}
                  className="text-purple-400 hover:text-purple-700 ml-0.5"
                  aria-label={`Remove tag ${t.tag}`}
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

        {/* Notes — one conversation card per note, newest first */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <p className="text-xs text-gray-500 mb-2">
                Paste raw notes in any format. AI will summarize and organize them in the background.
              </p>
              <textarea
                placeholder="Paste your conversation notes here..."
                value={noteRaw}
                onChange={(e) => setNoteRaw(e.target.value)}
                rows={10}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 text-gray-900 placeholder-gray-400 font-mono"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowNoteForm(false); setNoteRaw('') }}
                  className="text-sm text-gray-600 px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNote}
                  disabled={!noteRaw.trim() || noteSaving}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {noteSaving ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {contact.notes.length === 0 && (
              <p className="text-sm text-gray-400">
                No notes yet. Add one to start tracking interactions.
              </p>
            )}

            {contact.notes.map((n) => {
              const isProcessing = !n.ai_summary && !n.ai_structured
              const rawText = n.raw_notes || n.full_notes || n.summary || ''
              const showingRaw = expandedRaw.has(n.id)
              const hasStructured =
                n.ai_structured && Object.keys(n.ai_structured).length > 0

              return (
                <div
                  key={n.id}
                  className="border border-gray-200 rounded-lg p-4 bg-white"
                >
                  {/* Date/time */}
                  <p className="text-xs text-gray-500 font-medium mb-3">
                    {new Date(n.created_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    at{' '}
                    {new Date(n.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>

                  {/* AI summary or processing state */}
                  {n.ai_summary ? (
                    <div className="bg-blue-50 border border-blue-100 rounded p-3 mb-3">
                      <p className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-1">
                        Summary
                      </p>
                      <p className="text-sm text-gray-900">{n.ai_summary}</p>
                    </div>
                  ) : isProcessing ? (
                    <div className="bg-gray-50 border border-gray-100 rounded p-3 mb-3 text-xs text-gray-500 italic flex items-center gap-2">
                      <svg
                        className="animate-spin h-3 w-3 text-gray-400"
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
                      AI is summarizing this note…
                    </div>
                  ) : null}

                  {/* Structured categories */}
                  {hasStructured && (
                    <div className="space-y-3 mb-3">
                      {NOTE_CATEGORY_ORDER.map((cat) => {
                        const bullets = n.ai_structured?.[cat]
                        if (!Array.isArray(bullets) || bullets.length === 0) return null
                        return (
                          <div key={cat}>
                            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                              {cat}
                            </h3>
                            <ul className="space-y-1">
                              {bullets.map((b, i) => (
                                <li
                                  key={i}
                                  className="text-sm text-gray-800 pl-4 relative"
                                >
                                  <span className="absolute left-0 text-gray-400">•</span>
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Show raw notes toggle at bottom */}
                  {rawText && (
                    <div className="pt-2 border-t border-gray-100">
                      <button
                        onClick={() => toggleRaw(n.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {showingRaw ? 'Hide raw notes' : 'Show raw notes'}
                      </button>
                      {showingRaw && (
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap mt-2 font-mono bg-gray-50 p-3 rounded border border-gray-200">
                          {rawText}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Edit contact modal (Task 2) */}
      {showEditModal && (
        <EditContactModal
          contact={{
            id: contact.id,
            name: contact.name,
            role: contact.role,
            company: contact.company,
            sector: contact.sector,
            email: contact.email,
            phone: contact.phone,
            referral_source: contact.referral_source,
            status: contact.status,
            next_step: contact.next_step,
            next_step_date: contact.next_step_date,
            last_contact_date: contact.last_contact_date,
            follow_up_cadence_days: contact.follow_up_cadence_days,
          }}
          onClose={() => setShowEditModal(false)}
          onSaved={() => fetchContact()}
        />
      )}

      {/* Toast notifications (Task 3) */}
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
