'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Mode = 'text' | 'image'

interface ExtractedContact {
  name: string | null
  company: string | null
  role: 'Operator' | 'Investor' | 'Consultant' | null
  email: string | null
  phone: string | null
  referral_source: string | null
  notes: string | null
}

interface Props {
  onClose: () => void
}

/**
 * Quick Add Contact modal — paste an email/message OR upload a screenshot
 * (LinkedIn profile, business card, email thread, Slack DM, etc.). Claude
 * extracts contact fields and the new-contact form pre-fills from them so
 * the user just reviews, edits, and saves. All the normal auto-processing
 * (sector inference, tag generation, watchlist sync, cadence defaults)
 * fires on save through the existing /api/contacts POST pipeline.
 */
export default function QuickAddModal({ onClose }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Shared: load a File (from input OR paste) as the current upload.
  function loadImageFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  // Clipboard paste support (Task 10 follow-up). Active ONLY while the
  // image tab is showing so pasting text into the other tab's textarea
  // keeps working normally. Listens document-wide so the user can paste
  // from anywhere on the modal — no focused drop target required.
  useEffect(() => {
    if (mode !== 'image') return

    function handlePaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      // Walk the DataTransferItemList looking for an image. Screenshots
      // from Cmd+Shift+4 (macOS) or Snip & Sketch (Windows) land as
      // image/png items.
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            loadImageFile(file)
            return
          }
        }
      }
      // Nothing image-y in the clipboard — leave the default paste behavior
      // alone so the user can still paste into other inputs if any are
      // ever rendered next to the upload area.
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [mode])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setImageFile(null)
      setImagePreview(null)
      return
    }
    loadImageFile(file)
  }

  async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // result is "data:image/png;base64,<data>"
        const match = result.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) {
          reject(new Error('Could not decode image file'))
          return
        }
        resolve({ mediaType: match[1], base64: match[2] })
      }
      reader.onerror = () => reject(reader.error || new Error('File read failed'))
      reader.readAsDataURL(file)
    })
  }

  async function extract() {
    setError(null)

    if (mode === 'text' && !text.trim()) {
      setError('Paste some text to extract from.')
      return
    }
    if (mode === 'image' && !imageFile) {
      setError('Upload an image to extract from.')
      return
    }

    setExtracting(true)
    try {
      const body: Record<string, unknown> = {}
      if (mode === 'text') {
        body.text = text.trim()
      } else if (mode === 'image' && imageFile) {
        const { base64, mediaType } = await fileToBase64(imageFile)
        body.imageBase64 = base64
        body.imageMediaType = mediaType
      }

      const res = await fetch('/api/contacts/quick-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Extract failed (${res.status})`)
      }

      const extracted: ExtractedContact = data.extracted
      // Stash the extracted fields so the new-contact form can pick them up
      // on mount. Using sessionStorage so nothing leaks across browser
      // sessions, and a one-shot read-and-clear pattern on the receiving side.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('quick-add-prefill', JSON.stringify(extracted))
      }
      router.push('/contacts/new?prefill=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extract failed')
    } finally {
      setExtracting(false)
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Quick Add Contact</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Paste an email/message or upload a screenshot. Claude extracts the contact info and pre-fills the form.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none flex-shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setMode('text')}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mode === 'text'
                ? 'border-blue-600 text-blue-700 bg-blue-50/30'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Paste text
          </button>
          <button
            onClick={() => setMode('image')}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              mode === 'image'
                ? 'border-blue-600 text-blue-700 bg-blue-50/30'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Upload screenshot
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {mode === 'text' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paste email, message, LinkedIn bio, or intro
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Forward an intro email, paste a LinkedIn profile bio, drop a Slack DM — anything with contact info. Claude will extract name, company, role, email, phone, and context.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 font-mono"
                placeholder="e.g. ---------- Forwarded message ---------&#10;From: Kate Chen &lt;kate@example.com&gt;&#10;To: Sammy Gottlieb&#10;Subject: Intro — Dr. Jane Smith @ Acme Health&#10;&#10;Sammy, meet Jane Smith — CMO at Acme Health. She's focused on VBC..."
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Upload a screenshot
              </label>
              <p className="text-xs text-gray-500 mb-3">
                LinkedIn profile header, email signature, business card, Slack profile card, etc. PNG, JPG, GIF, or WebP. Keep under 5 MB — crop to just the relevant section for best results.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />

              {imagePreview ? (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="max-h-80 max-w-full mx-auto rounded border border-gray-200"
                  />
                  <div className="flex justify-between items-center mt-3 text-xs text-gray-500">
                    <span>
                      {imageFile?.name} ·{' '}
                      {imageFile ? (imageFile.size / 1024).toFixed(0) : '0'} KB
                    </span>
                    <button
                      onClick={() => {
                        setImageFile(null)
                        setImagePreview(null)
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-blue-400 hover:bg-blue-50/30 transition-colors flex flex-col items-center justify-center gap-2 text-sm text-gray-600"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-gray-400"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="font-medium">Click to upload an image</span>
                  <span className="text-xs text-gray-400">
                    PNG, JPG, GIF, WebP up to 5 MB
                  </span>
                  <span className="text-xs text-gray-500 mt-1">
                    or paste from clipboard (
                    <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">
                      ⌘V
                    </kbd>
                    {' / '}
                    <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">
                      Ctrl+V
                    </kbd>
                    )
                  </span>
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={extract}
            disabled={extracting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {extracting && (
              <svg
                className="animate-spin h-4 w-4"
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
            )}
            {extracting ? 'Extracting…' : 'Extract & continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
