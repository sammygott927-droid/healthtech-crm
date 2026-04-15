import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE, expectedAuthToken, safeEqual } from '@/lib/auth'

// Next.js 16 renames middleware.ts → proxy.ts. Same semantics.
// This gates every page + API route behind APP_PASSWORD. The matcher below
// excludes static assets, the login page/API, and Vercel Cron (which is
// authed separately by CRON_SECRET).

export async function proxy(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD

  // If APP_PASSWORD isn't configured, we do NOT want to run a wide-open app
  // in production. But we also don't want to brick local dev before the user
  // has set it. Compromise: let everything through with a console warning.
  // Once APP_PASSWORD is set, gating turns on automatically.
  if (!appPassword) {
    console.warn('[proxy] APP_PASSWORD not set — auth gating is OFF. Set it in .env.local / Vercel.')
    return NextResponse.next()
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value
  const expected = await expectedAuthToken(appPassword)

  if (cookie && safeEqual(cookie, expected)) {
    return NextResponse.next()
  }

  // Not authed: redirect HTML navigations to /login, return 401 for API/fetch.
  const { pathname, search } = request.nextUrl

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  // Preserve where the user was trying to go so we can redirect back after login
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', pathname + search)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // Match everything EXCEPT:
  // - /login, /api/login, /api/logout (need to be reachable unauthed)
  // - /api/cron-* and /api/daily-brief (Vercel Cron — authed via CRON_SECRET header)
  // - _next static / image optimization, favicon, robots, sitemap
  matcher: [
    '/((?!login|api/login|api/logout|api/daily-brief|api/cron|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
