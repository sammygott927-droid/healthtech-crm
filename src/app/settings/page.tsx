'use client'

import { useState, useEffect } from 'react'

interface Settings {
  email: string
  briefTime: string
  cadenceInvestor: number
  cadenceOperator: number
  cadenceConsultant: number
}

interface NewsSource {
  id: string
  name: string
  url: string
  created_at: string
}

const DEFAULT_SETTINGS: Settings = {
  email: '',
  briefTime: '7:00 AM ET',
  cadenceInvestor: 60,
  cadenceOperator: 60,
  cadenceConsultant: 120,
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [retagging, setRetagging] = useState(false)
  const [retagResult, setRetagResult] = useState<string>('')
  const [restructuring, setRestructuring] = useState(false)
  const [restructureResult, setRestructureResult] = useState<string>('')
  const [reinferring, setReinferring] = useState(false)
  const [reinferResult, setReinferResult] = useState<string>('')

  // News sources state
  const [sources, setSources] = useState<NewsSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState('')
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceUrl, setNewSourceUrl] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('crm-settings')
    if (stored) {
      setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
    }
  }, [])

  // Load news sources on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setSourcesLoading(true)
      try {
        const res = await fetch('/api/news-sources')
        const data = await res.json()
        if (cancelled) return
        if (Array.isArray(data)) {
          setSources(data)
          setSourcesError('')
        } else {
          setSourcesError(data?.error || 'Failed to load sources')
        }
      } catch (err) {
        if (!cancelled) setSourcesError(String(err))
      } finally {
        if (!cancelled) setSourcesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault()
    if (!newSourceName.trim() || !newSourceUrl.trim() || adding) return
    setAdding(true)
    setSourcesError('')
    try {
      const res = await fetch('/api/news-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSourceName.trim(), url: newSourceUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSourcesError(data?.error || `HTTP ${res.status}`)
      } else {
        setSources((prev) => [data, ...prev])
        setNewSourceName('')
        setNewSourceUrl('')
      }
    } catch (err) {
      setSourcesError(String(err))
    } finally {
      setAdding(false)
    }
  }

  async function handleDeleteSource(id: string, name: string) {
    if (!confirm(`Delete source "${name}"? This removes it from the daily brief pipeline.`)) return
    const prev = sources
    // Optimistic remove
    setSources((s) => s.filter((x) => x.id !== id))
    try {
      const res = await fetch(`/api/news-sources/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSources(prev) // rollback
        setSourcesError(data?.error || 'Failed to delete')
      }
    } catch (err) {
      setSources(prev)
      setSourcesError(String(err))
    }
  }

  // Safely parse a response — if the server returned a non-JSON error (e.g. a
  // Vercel function timeout page, which is plain text "An error occurred..."),
  // surface it without crashing on res.json().
  async function safeParse(res: Response): Promise<{ ok: boolean; data: Record<string, unknown>; rawText?: string }> {
    const text = await res.text()
    try {
      return { ok: res.ok, data: JSON.parse(text) as Record<string, unknown> }
    } catch {
      return { ok: res.ok, data: {}, rawText: text }
    }
  }

  async function handleRetagAll() {
    if (!confirm('Re-generate AI tags for all contacts that have notes? This will replace existing auto-generated tags (manual tags are preserved). May take a few minutes.')) return
    setRetagging(true)
    setRetagResult('')
    try {
      const res = await fetch('/api/retag-all', { method: 'POST' })
      const { ok, data, rawText } = await safeParse(res)
      if (ok) {
        setRetagResult(`Re-tagged ${data.processed} of ${data.contacts_with_notes} contacts with notes.${Number(data.errors) > 0 ? ` ${data.errors} errors.` : ''}`)
      } else {
        setRetagResult(`Error: ${(data.error as string) || rawText?.slice(0, 200) || 'Unknown error'}`)
      }
    } catch (err) {
      setRetagResult(`Error: ${String(err)}`)
    } finally {
      setRetagging(false)
    }
  }

  async function handleRestructureAll() {
    if (!confirm('Re-process EVERY note through Claude to regenerate ai_summary + the 6-category structured view? Useful after the notes-redesign migration when ai_summary was backfilled with the old short summary text. May take a few minutes.')) return
    setRestructuring(true)
    setRestructureResult('Starting...')
    try {
      const res = await fetch('/api/restructure-notes-all?force=1', { method: 'POST' })
      const { ok, data, rawText } = await safeParse(res)
      if (ok) {
        const processed = Number(data.processed) || 0
        const total = Number(data.total) || 0
        const skipped = Number(data.skipped) || 0
        const errors = Number(data.errors) || 0
        const elapsed = data.elapsed_seconds ? ` (${data.elapsed_seconds}s)` : ''

        if (total === 0) {
          setRestructureResult(
            `No notes found in the database. ${data.message ? `(${data.message})` : ''}`
          )
        } else {
          setRestructureResult(
            `Restructured ${processed} of ${total} notes${elapsed}.` +
              (skipped > 0 ? ` ${skipped} skipped.` : '') +
              (errors > 0 ? ` ${errors} errors.` : '')
          )
        }
      } else {
        setRestructureResult(`Error: ${(data.error as string) || rawText?.slice(0, 200) || 'Unknown error'}`)
      }
    } catch (err) {
      setRestructureResult(`Error: ${String(err)}`)
    } finally {
      setRestructuring(false)
    }
  }

  async function handleReinferSectors() {
    if (!confirm('Re-infer a specific niche healthcare sector for every contact using their profile + notes? This will OVERWRITE the current sector field (e.g. "Healthcare" → "value-based care / Medicare Advantage"). Contacts are processed in batches of 20 — this may take a few minutes.')) return

    setReinferring(true)
    setReinferResult('Starting...')

    const BATCH_SIZE = 20
    let offset = 0
    let total = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalErrors = 0
    let batchNum = 0

    try {
      // Loop until the server says done
      // Safety cap to avoid a runaway loop if the server misbehaves
      for (let i = 0; i < 100; i++) {
        batchNum++
        const res = await fetch(`/api/reinfer-sectors-all?offset=${offset}&limit=${BATCH_SIZE}`, {
          method: 'POST',
        })
        const { ok, data, rawText } = await safeParse(res)

        if (!ok) {
          const errMsg = (data.error as string) || rawText?.slice(0, 200) || 'Unknown error'
          const hint = rawText?.toLowerCase().includes('timed out') || rawText?.toLowerCase().includes('an error occurred')
            ? ' (A batch timed out. Partial progress above was saved.)'
            : ''
          setReinferResult(`Error on batch ${batchNum}: ${errMsg}${hint}${totalUpdated > 0 ? ` — ${totalUpdated} contacts updated before this failure.` : ''}`)
          return
        }

        total = Number(data.total) || total
        totalUpdated += Number(data.updated) || 0
        totalSkipped += Number(data.skipped) || 0
        totalErrors += Number(data.errors) || 0

        const totalBatches = Math.max(1, Math.ceil(total / BATCH_SIZE))
        const rangeStart = offset + 1
        const rangeEnd = offset + (Number(data.batch_size) || 0)

        if (data.done) {
          setReinferResult(
            `Done. Updated ${totalUpdated} of ${total} contacts.` +
              (totalSkipped > 0 ? ` ${totalSkipped} skipped (UNKNOWN).` : '') +
              (totalErrors > 0 ? ` ${totalErrors} errors.` : '')
          )
          return
        }

        setReinferResult(
          `Processing batch ${batchNum} of ${totalBatches}... (contacts ${rangeStart}-${rangeEnd} of ${total}) — ${totalUpdated} updated so far`
        )

        offset = Number(data.next_offset) || (offset + BATCH_SIZE)
      }

      setReinferResult(`Stopped after 100 batches to avoid a runaway loop. ${totalUpdated} updated.`)
    } catch (err) {
      setReinferResult(`Error on batch ${batchNum}: ${String(err)}${totalUpdated > 0 ? ` — ${totalUpdated} contacts updated before this failure.` : ''}`)
    } finally {
      setReinferring(false)
    }
  }

  function updateField(field: keyof Settings, value: string | number) {
    setSettings((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  function handleSave() {
    localStorage.setItem('crm-settings', JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-8">
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        {/* News Sources — FIRST section (Task 2) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">News Sources</h2>
          <p className="text-xs text-gray-500 mb-4">
            RSS/blog feeds pulled into your daily brief alongside Google News. Paste any RSS or blog URL — if a feed fails to load, delete it and try a different URL (e.g. <code className="bg-gray-100 px-1 rounded text-[11px]">/rss</code>, <code className="bg-gray-100 px-1 rounded text-[11px]">/feed</code>, <code className="bg-gray-100 px-1 rounded text-[11px]">/atom.xml</code>).
          </p>

          {/* List */}
          <div className="space-y-2 mb-4">
            {sourcesLoading ? (
              <p className="text-xs text-gray-400">Loading sources...</p>
            ) : sources.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No sources yet. Add one below, or run the migration in <code className="bg-gray-100 px-1 rounded">supabase-news-sources-migration.sql</code> to seed defaults.
              </p>
            ) : (
              sources.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate block"
                    >
                      {s.url}
                    </a>
                  </div>
                  <button
                    onClick={() => handleDeleteSource(s.id, s.name)}
                    className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0"
                    title="Delete source"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Add form */}
          <form onSubmit={handleAddSource} className="border-t border-gray-200 pt-4 space-y-2">
            <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <input
                type="text"
                placeholder="Name (e.g. Out-of-Pocket)"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400"
              />
              <input
                type="url"
                placeholder="https://example.com/feed"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400"
              />
              <button
                type="submit"
                disabled={adding || !newSourceName.trim() || !newSourceUrl.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add Source'}
              </button>
            </div>
            {sourcesError && <p className="text-xs text-red-600">{sourcesError}</p>}
          </form>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              My Email Address
            </label>
            <p className="text-xs text-gray-400 mb-2">Where daily briefs are sent. Also set as USER_EMAIL in your Vercel environment variables.</p>
            <input
              type="email"
              value={settings.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400"
            />
          </div>

          {/* Brief Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Brief Time
            </label>
            <p className="text-xs text-gray-400 mb-2">Configured via Vercel Cron. Currently set to 7:00 AM ET.</p>
            <input
              type="text"
              value={settings.briefTime}
              onChange={(e) => updateField('briefTime', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
              disabled
            />
          </div>

          {/* Follow-up Cadences */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Default Follow-Up Cadences (days)
            </label>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Investor</label>
                <input
                  type="number"
                  value={settings.cadenceInvestor}
                  onChange={(e) => updateField('cadenceInvestor', parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Operator</label>
                <input
                  type="number"
                  value={settings.cadenceOperator}
                  onChange={(e) => updateField('cadenceOperator', parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Consultant</label>
                <input
                  type="number"
                  value={settings.cadenceConsultant}
                  onChange={(e) => updateField('cadenceConsultant', parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* Environment Variables Info */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Environment Variables</h3>
            <p className="text-xs text-gray-400 mb-2">
              These are configured in your <code className="bg-gray-100 px-1 rounded">.env.local</code> file (locally) or Vercel project settings (production).
            </p>
            <div className="bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-600 space-y-1">
              <p>NEXT_PUBLIC_SUPABASE_URL</p>
              <p>NEXT_PUBLIC_SUPABASE_ANON_KEY</p>
              <p>CLAUDE_API_KEY</p>
              <p>RESEND_API_KEY</p>
              <p>USER_EMAIL</p>
            </div>
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>

        {/* Maintenance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mt-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Maintenance</h2>
          <p className="text-xs text-gray-400 mb-4">One-time operations for bulk data management.</p>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">Re-tag all contacts with notes</h3>
            <p className="text-xs text-gray-500 mb-3">
              Uses AI to read each contact&apos;s notes and regenerate specific thesis/interest tags (e.g. value-based care, pulmonary rehab, Series A healthtech). Manual tags are preserved. Contacts with no notes are left alone.
            </p>
            <button
              onClick={handleRetagAll}
              disabled={retagging}
              className="bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm transition-colors"
            >
              {retagging ? 'Re-tagging... (this may take a few minutes)' : 'Re-tag All Contacts'}
            </button>
            {retagResult && (
              <p className="text-xs text-gray-600 mt-3">{retagResult}</p>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-1">Restructure all notes</h3>
            <p className="text-xs text-gray-500 mb-3">
              Re-runs Claude on every note that has raw content, regenerating
              both the 1-2 sentence AI summary and the 6-category structured
              view (How we met, Areas of interest, Advice given, Key takeaways,
              Next steps, Miscellaneous). Use this after the notes-redesign
              migration to replace any backfilled <code className="bg-gray-100 px-1 rounded text-[11px]">ai_summary</code> text
              (e.g. pipe-delimited import snippets) with proper AI-written
              summaries. Raw notes are untouched.
            </p>
            <button
              onClick={handleRestructureAll}
              disabled={restructuring}
              className="bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm transition-colors"
            >
              {restructuring ? 'Restructuring... (this may take a few minutes)' : 'Restructure All Notes'}
            </button>
            {restructureResult && (
              <p className="text-xs text-gray-600 mt-3">{restructureResult}</p>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-1">Re-infer all sectors</h3>
            <p className="text-xs text-gray-500 mb-3">
              Uses AI to replace generic sectors (e.g. &quot;Healthcare&quot;, &quot;Digital Health&quot;) with specific niches mined from notes (e.g. &quot;value-based care / Medicare Advantage&quot;, &quot;pulmonary rehab&quot;, &quot;Series A healthtech&quot;). Overwrites the sector field.
            </p>
            <button
              onClick={handleReinferSectors}
              disabled={reinferring}
              className="bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm transition-colors"
            >
              {reinferring ? 'Re-inferring... (this may take a few minutes)' : 'Re-infer All Sectors'}
            </button>
            {reinferResult && (
              <p className="text-xs text-gray-600 mt-3">{reinferResult}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
