import type { NewsItem } from './news-fetcher'

/**
 * Strict freshness filter for the Daily Brief pipeline.
 *
 * Why this exists: Google News RSS has a `when:7d` query modifier but it's
 * unreliable — stale articles from years back still slip through, especially
 * for long-tail company queries with sparse results. Custom RSS feeds have
 * no such filter at all, so old podcast/blog backlogs can flood the brief.
 *
 * This helper parses each item's pubDate tolerantly (RFC-822, ISO-8601, and
 * a few dc:date variants) and rejects anything older than `maxAgeDays`.
 * Items with an UNPARSEABLE date are DROPPED by default — safer to lose a
 * possibly-fresh item than to accept an archive story that looks recent.
 */

const PARSE_FAILED = Symbol('date-parse-failed')

function parsePubDate(pubDate: string): Date | typeof PARSE_FAILED {
  if (!pubDate || typeof pubDate !== 'string') return PARSE_FAILED
  const trimmed = pubDate.trim()
  if (!trimmed) return PARSE_FAILED

  // First try: native Date parses RFC-822 ("Wed, 05 Nov 2025 14:30:00 GMT")
  // and ISO-8601 ("2025-11-05T14:30:00Z") out of the box.
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed

  // Fallback: strip trailing timezone abbreviations that JS can't parse
  // (e.g. "2025-11-05 14:30:00 PDT" — rare but seen in some feeds)
  const stripped = trimmed.replace(/\s+(PDT|PST|EDT|EST|CDT|CST|MDT|MST|BST|CET|CEST)$/i, '')
  if (stripped !== trimmed) {
    const retry = new Date(stripped)
    if (!Number.isNaN(retry.getTime())) return retry
  }

  return PARSE_FAILED
}

export interface DateFilterStats {
  kept: NewsItem[]
  rejected_old: number      // articles older than the cutoff
  rejected_unparseable: number  // pubDate didn't parse (treated as old)
  rejected_future: number   // pubDate > now + 1 day (clock skew / junk)
  cutoff_iso: string
}

export function filterByMaxAge(
  articles: NewsItem[],
  maxAgeDays = 7,
  now: Date = new Date()
): DateFilterStats {
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)
  // Small tolerance for future-dated items (clock skew, mid-flight publishes)
  const futureTolerance = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const kept: NewsItem[] = []
  let rejected_old = 0
  let rejected_unparseable = 0
  let rejected_future = 0

  for (const article of articles) {
    const dt = parsePubDate(article.pubDate)
    if (dt === PARSE_FAILED) {
      rejected_unparseable++
      continue
    }
    if (dt < cutoff) {
      rejected_old++
      continue
    }
    if (dt > futureTolerance) {
      rejected_future++
      continue
    }
    kept.push(article)
  }

  return {
    kept,
    rejected_old,
    rejected_unparseable,
    rejected_future,
    cutoff_iso: cutoff.toISOString(),
  }
}
