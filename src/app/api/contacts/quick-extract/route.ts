import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAnthropic() {
  const key = process.env.CLAUDE_API_KEY
  if (!key) throw new Error('CLAUDE_API_KEY is not set')
  return new Anthropic({ apiKey: key })
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

const EXTRACT_PROMPT = `You are a healthcare networking CRM assistant. Extract contact information from the source provided — which may be an email thread, a LinkedIn screenshot, a business card, a Slack/DM, a forwarded message, or similar.

Return a SINGLE JSON object with these fields. Use null when a field is not present or you're not confident:

{
  "name": "Full name (first + last)",
  "company": "Company / firm name",
  "role": "Operator" | "Investor" | "Consultant" | null,
  "email": "email@example.com",
  "phone": "normalized phone if visible",
  "referral_source": "how we met if stated (e.g. 'intro from Kate', 'LinkedIn cold outreach')",
  "notes": "Free-text notes capturing any substantive context — thesis areas, topics discussed, companies mentioned, planned next steps, background details. Paste-quality: what you'd want to remember later. Leave null if the source is just a name + contact info with no context."
}

RULES:
1. role inference:
   - "Investor" if the source suggests they're at a VC firm / fund / family office (titles: GP, Partner, Principal, Associate at named fund; phrases like "my firm invests in", "our portfolio").
   - "Consultant" if titles suggest management consulting / advisory (McKinsey, Bain, BCG, Oliver Wyman, Chartis, Sg2, independent advisor).
   - "Operator" for everyone else at a healthcare / healthtech company (CEO, VP, clinician, PM, engineer, etc.).
   - null if the source doesn't give enough signal.
2. Do NOT fabricate an email/phone — only include if explicitly visible.
3. Do NOT guess names from email usernames alone (e.g. "sarah.smith@x.com" → "sarah.smith@x.com" is not enough on its own).
4. For notes: be specific and paste-faithful. Quote what they said if it's short and distinctive.

Return ONLY the JSON object, no markdown fencing, no preamble.`

interface ExtractedContact {
  name: string | null
  company: string | null
  role: 'Operator' | 'Investor' | 'Consultant' | null
  email: string | null
  phone: string | null
  referral_source: string | null
  notes: string | null
}

function parseExtracted(text: string): ExtractedContact {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object in Claude response')
  }
  const parsed = JSON.parse(text.slice(first, last + 1))

  const asStringOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null

  const roleRaw = asStringOrNull(parsed.role)
  const role: ExtractedContact['role'] =
    roleRaw === 'Operator' || roleRaw === 'Investor' || roleRaw === 'Consultant'
      ? roleRaw
      : null

  return {
    name: asStringOrNull(parsed.name),
    company: asStringOrNull(parsed.company),
    role,
    email: asStringOrNull(parsed.email),
    phone: asStringOrNull(parsed.phone),
    referral_source: asStringOrNull(parsed.referral_source),
    notes: asStringOrNull(parsed.notes),
  }
}

/**
 * POST /api/contacts/quick-extract
 *
 * Body: either
 *   { text: string }                                    — paste from email/message
 *   { imageBase64: string, imageMediaType: string }     — screenshot upload
 *
 * Returns: { extracted: ExtractedContact, raw?: string }
 */
export async function POST(request: NextRequest) {
  let body: { text?: unknown; imageBase64?: unknown; imageMediaType?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : ''
  const imageMediaType = typeof body.imageMediaType === 'string' ? body.imageMediaType.trim() : ''

  if (!text && !imageBase64) {
    return NextResponse.json(
      { error: 'Provide either `text` or `imageBase64` + `imageMediaType`' },
      { status: 400 }
    )
  }

  if (imageBase64 && !ALLOWED_IMAGE_TYPES.has(imageMediaType)) {
    return NextResponse.json(
      {
        error: `Unsupported image type. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
      },
      { status: 400 }
    )
  }

  // Cap image size at ~5MB of base64 (roughly 3.75MB raw) — Claude accepts
  // larger but users uploading multi-meg PNGs of a LinkedIn page is almost
  // always a sign of screenshotting the wrong thing.
  if (imageBase64 && imageBase64.length > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Image too large — please crop to just the relevant section' },
      { status: 413 }
    )
  }

  // Build Claude content block(s). If both text and image are provided, send
  // both — the prompt is tolerant of either.
  const content: Anthropic.ContentBlockParam[] = []

  if (imageBase64) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: imageBase64,
      },
    })
  }

  content.push({ type: 'text', text: text ? `${EXTRACT_PROMPT}\n\nSOURCE:\n${text}` : EXTRACT_PROMPT })

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content }],
    })

    const respText = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const extracted = parseExtracted(respText)

    return NextResponse.json({ extracted })
  } catch (err) {
    console.error('[quick-extract] Claude call failed:', err)
    return NextResponse.json(
      { error: 'Extraction failed', details: String(err).slice(0, 300) },
      { status: 500 }
    )
  }
}
