'use client'

import { useState, useEffect } from 'react'

interface Settings {
  email: string
  briefTime: string
  cadenceInvestor: number
  cadenceOperator: number
  cadenceConsultant: number
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

  useEffect(() => {
    const stored = localStorage.getItem('crm-settings')
    if (stored) {
      setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
    }
  }, [])

  async function handleRetagAll() {
    if (!confirm('Re-generate AI tags for all contacts that have notes? This will replace existing auto-generated tags (manual tags are preserved). May take a few minutes.')) return
    setRetagging(true)
    setRetagResult('')
    try {
      const res = await fetch('/api/retag-all', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setRetagResult(`Re-tagged ${data.processed} of ${data.contacts_with_notes} contacts with notes.${data.errors > 0 ? ` ${data.errors} errors.` : ''}`)
      } else {
        setRetagResult(`Error: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      setRetagResult(`Error: ${String(err)}`)
    } finally {
      setRetagging(false)
    }
  }

  async function handleRestructureAll() {
    if (!confirm('Rebuild the structured notes view for all contacts that have notes? This reads each contact\'s notes and regenerates the 6-category view + 1-2 sentence summary. May take a few minutes.')) return
    setRestructuring(true)
    setRestructureResult('')
    try {
      const res = await fetch('/api/restructure-notes-all', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setRestructureResult(`Restructured ${data.processed} of ${data.contacts_with_notes} contacts with notes.${data.errors > 0 ? ` ${data.errors} errors.` : ''}`)
      } else {
        setRestructureResult(`Error: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      setRestructureResult(`Error: ${String(err)}`)
    } finally {
      setRestructuring(false)
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
              Rebuilds the 6-category structured view (How we met, Areas of interest, Advice given, Key takeaways, Next steps, Miscellaneous) plus a 1-2 sentence summary for every contact with notes. Raw notes are untouched.
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
        </div>
      </div>
    </div>
  )
}
