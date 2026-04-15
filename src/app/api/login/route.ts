import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, expectedAuthToken } from '@/lib/auth'

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD
  if (!appPassword) {
    return NextResponse.json(
      { error: 'APP_PASSWORD is not configured on the server' },
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

  if (!password || password !== appPassword) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }

  const token = await expectedAuthToken(appPassword)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // 30 days. The cookie is invalidated automatically if APP_PASSWORD changes.
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
