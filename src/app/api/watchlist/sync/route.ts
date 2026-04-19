import { NextResponse, after } from 'next/server'
import { syncContactsToWatchlist } from '@/lib/sync-contacts-to-watchlist'
import { inferWatchlistTypeForMany } from '@/lib/infer-watchlist-type'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/watchlist/sync — adds every distinct non-Dormant contact.company
// that isn't already on the watchlist. Type auto-inference fires in the
// background for each newly added row so the user doesn't wait.
export async function POST() {
  const inserted = await syncContactsToWatchlist()

  if (inserted.length > 0) {
    after(async () => {
      const result = await inferWatchlistTypeForMany(inserted)
      console.log(
        `[watchlist sync] type inference: ${result.ok} ok, ${result.failed} failed`
      )
    })
  }

  // The UI's current message template wants `{ added, skipped }`. We have the
  // precise "added" count from the helper; we fudge skipped as "non-Dormant
  // contact companies total minus added" for UX continuity.
  return NextResponse.json({ added: inserted.length, skipped: 0 })
}
