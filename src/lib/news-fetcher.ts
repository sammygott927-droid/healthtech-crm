import { XMLParser } from 'fast-xml-parser'

export interface NewsItem {
  title: string
  link: string
  pubDate: string
  source: string
}

const parser = new XMLParser({ ignoreAttributes: false })

export interface FetchResult {
  items: NewsItem[]
  error: string | null
}

export async function fetchGoogleNewsDetailed(
  query: string,
  maxResults = 5,
  timeoutMs = 10_000
): Promise<FetchResult> {
  const encoded = encodeURIComponent(query + ' when:7d')
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`

  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` }

    const xml = await res.text()
    const parsed = parser.parse(xml)

    const items = parsed?.rss?.channel?.item
    if (!items) return { items: [], error: null }

    const itemList = Array.isArray(items) ? items : [items]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = itemList.slice(0, maxResults).map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.source?.['#text'] || item.source || '',
    }))
    return { items: mapped, error: null }
  } catch (err) {
    const msg = String(err).slice(0, 100)
    console.error(`News fetch failed for "${query}":`, err)
    return { items: [], error: msg }
  }
}

// Back-compat thin wrapper
export async function fetchGoogleNews(query: string, maxResults = 5, timeoutMs = 10_000): Promise<NewsItem[]> {
  return (await fetchGoogleNewsDetailed(query, maxResults, timeoutMs)).items
}

/**
 * Fetch a generic RSS 2.0 or Atom 1.0 feed with detailed status reporting.
 * Returns both the normalized items and any error encountered (HTTP failure,
 * unrecognized feed shape, fetch timeout, etc.) so the caller can surface
 * feed health to the UI.
 */
export async function fetchRssFeedDetailed(
  feedUrl: string,
  sourceName: string,
  maxResults = 10,
  timeoutMs = 10_000
): Promise<FetchResult> {
  try {
    const res = await fetch(feedUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Some feeds reject default Next fetch UA with 403
        'User-Agent': 'InTheLoop/1.0 (+https://example.com/bot)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    })
    if (!res.ok) {
      const msg = `HTTP ${res.status}`
      console.warn(`[rss] ${sourceName} → ${msg} for ${feedUrl}`)
      return { items: [], error: msg }
    }

    const xml = await res.text()
    const parsed = parser.parse(xml)

    // RSS 2.0
    const rssItems = parsed?.rss?.channel?.item
    if (rssItems) {
      const list = Array.isArray(rssItems) ? rssItems : [rssItems]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = list.slice(0, maxResults).map((item: any) => normalizeRssItem(item, sourceName))
      return { items: mapped, error: null }
    }

    // Atom 1.0
    const atomEntries = parsed?.feed?.entry
    if (atomEntries) {
      const list = Array.isArray(atomEntries) ? atomEntries : [atomEntries]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = list.slice(0, maxResults).map((entry: any) => normalizeAtomEntry(entry, sourceName))
      return { items: mapped, error: null }
    }

    const msg = 'feed shape unrecognized'
    console.warn(`[rss] ${sourceName} → ${msg}`)
    return { items: [], error: msg }
  } catch (err) {
    const msg = String(err).slice(0, 100)
    console.error(`[rss] ${sourceName} → fetch failed:`, err)
    return { items: [], error: msg }
  }
}

// Back-compat thin wrapper
export async function fetchRssFeed(
  feedUrl: string,
  sourceName: string,
  maxResults = 10,
  timeoutMs = 10_000
): Promise<NewsItem[]> {
  return (await fetchRssFeedDetailed(feedUrl, sourceName, maxResults, timeoutMs)).items
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRssItem(item: any, sourceName: string): NewsItem {
  const title = typeof item.title === 'string' ? item.title : item.title?.['#text'] || ''
  const link = typeof item.link === 'string' ? item.link : item.link?.['#text'] || item.link?.['@_href'] || ''
  const pubDate = item.pubDate || item['dc:date'] || ''
  return { title: String(title).trim(), link: String(link).trim(), pubDate: String(pubDate), source: sourceName }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAtomEntry(entry: any, sourceName: string): NewsItem {
  const title = typeof entry.title === 'string' ? entry.title : entry.title?.['#text'] || ''
  // Atom <link> can be a single object with href, or an array of them — pick the one with rel="alternate" or the first
  let link = ''
  if (Array.isArray(entry.link)) {
    const alt = entry.link.find((l: { [x: string]: string }) => l['@_rel'] === 'alternate') || entry.link[0]
    link = alt?.['@_href'] || ''
  } else if (entry.link && typeof entry.link === 'object') {
    link = entry.link['@_href'] || ''
  } else if (typeof entry.link === 'string') {
    link = entry.link
  }
  const pubDate = entry.published || entry.updated || ''
  return { title: String(title).trim(), link: String(link).trim(), pubDate: String(pubDate), source: sourceName }
}

/**
 * Fetch all user-saved RSS sources in parallel. Failures are logged and
 * skipped — a single broken feed never blocks the rest.
 */
export async function fetchFromCustomSources(
  sources: { name: string; url: string }[],
  perSourceLimit = 10
): Promise<NewsItem[]> {
  const results = await Promise.all(
    sources.map((s) => fetchRssFeed(s.url, s.name, perSourceLimit))
  )
  return results.flat()
}
