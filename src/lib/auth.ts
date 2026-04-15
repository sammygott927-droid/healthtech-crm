// Lightweight single-user auth for gating the whole app.
//
// The cookie value is the hex SHA-256 of APP_PASSWORD. The proxy (middleware)
// recomputes it on each request and compares. No database, no JWT lib,
// edge-runtime compatible (uses Web Crypto). Good enough for a single-user
// CRM; if APP_PASSWORD rotates, all sessions are invalidated automatically.

export const AUTH_COOKIE = 'crm_auth'

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function expectedAuthToken(appPassword: string): Promise<string> {
  // Prefix is a version tag so future token-format changes can invalidate old cookies.
  return sha256Hex(`v1|${appPassword}`)
}

// Constant-time string compare (fixed-length hex hashes — timing differences
// are minimal, but be explicit anyway).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
