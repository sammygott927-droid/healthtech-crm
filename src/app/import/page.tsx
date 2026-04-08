'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ imported: number; total: number; errors?: string[] } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleUpload() {
    if (!file) return
    setStatus('uploading')
    setErrorMsg('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/import-csv', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setErrorMsg(data.error || 'Import failed')
        return
      }

      setResult(data)
      setStatus('done')
    } catch {
      setStatus('error')
      setErrorMsg('Network error')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Import Contacts</h1>
          <div className="flex gap-3">
            <Link
              href="/"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Command Center
            </Link>
            <Link
              href="/contacts"
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded font-medium hover:bg-gray-200 text-sm"
            >
              Contacts
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-sm text-gray-600 mb-4">
            Upload a CSV with columns: name, role, company, sector, referral_source, status, next_step, email, phone, last_contact_date, notes.
            Column order doesn&apos;t matter. Missing fields will be left blank.
          </p>

          <label className="block mb-4">
            <span className="text-sm font-medium text-gray-700">Choose CSV file</span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </label>

          <button
            onClick={handleUpload}
            disabled={!file || status === 'uploading'}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'uploading' ? 'Importing...' : 'Import Contacts'}
          </button>

          {status === 'done' && result && (
            <div className="mt-4 p-4 bg-green-50 rounded text-sm">
              <p className="text-green-800 font-medium">
                Successfully imported {result.imported} of {result.total} contacts.
              </p>
              {result.errors && result.errors.length > 0 && (
                <ul className="mt-2 text-yellow-700 list-disc list-inside">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <Link href="/contacts" className="inline-block mt-3 text-blue-600 hover:underline">
                View Contacts →
              </Link>
            </div>
          )}

          {status === 'error' && (
            <p className="mt-4 text-sm text-red-600">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  )
}
