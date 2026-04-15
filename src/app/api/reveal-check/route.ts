import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

// Validates the REVEAL_PASSWORD for un-masking emails/phones in the UI.
// Returns {ok: true} on match so the client can flip a sessionStorage flag.
// Note: the app is already gated by APP_PASSWORD; this is a second lock
// specifically for shoulder-surfing protection of PII.
export async function POST(request: NextRequest) {
  const revealPassword = process.env.REVEAL_PASSWORD
  if (!revealPassword) {
    return NextResponse.json(
      { error: 'REVEAL_PASSWORD is not configured on the server' },
      { status: 500 }
    )
  }

  let password = ''
  try {
    const body = await request.json()
    password = typeof body?.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  if (!password || password !== revealPassword) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
