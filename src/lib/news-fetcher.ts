import { XMLParser } from 'fast-xml-parser'

export interface NewsItem {
  title: string
  link: string
  pubDate: string
  source: string
}

const parser = new XMLParser({ ignoreAttributes: false })

export async function fetchGoogleNews(query: string, maxResults = 5): Promise<NewsItem[]> {
  const encoded = encodeURIComponent(query + ' when:7d')
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return []

    const xml = await res.text()
    const parsed = parser.parse(xml)

    const items = parsed?.rss?.channel?.item
    if (!items) return []

    const itemList = Array.isArray(items) ? items : [items]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return itemList.slice(0, maxResults).map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.source?.['#text'] || item.source || '',
    }))
  } catch (err) {
    console.error(`News fetch failed for "${query}":`, err)
    return []
  }
}

/**
 * Fetch a generic RSS 2.0 or Atom 1.0 feed and return normalized NewsItems.
 * Tolerates the two common shapes and falls back gracefully when fields are
 * missing. `sourceName` is used as the item source (since feeds don't carry
 * their own name consistently).
 */
export async function fetchRssFeed(
  feedUrl: string,
  sourceName: string,
  maxResults = 10
): Promise<NewsItem[]> {
  try {
    const res = await fetch(feedUrl, {
      cache: 'no-store',
      headers: {
        // Some feeds reject default Next fetch UA with 403
        'User-Agent': 'HealthTechCRM/1.0 (+https://example.com/bot)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    })
    if (!res.ok) {
      console.warn(`[rss] ${sourceName} → HTTP ${res.status} for ${feedUrl}`)
      return []
    }

    const xml = await res.text()
    const parsed = parser.parse(xml)

    // RSS 2.0
    const rssItems = parsed?.rss?.channel?.item
    if (rssItems) {
      const list = Array.isArray(rssItems) ? rssItems : [rssItems]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return list.slice(0, maxResults).map((item: any) => normalizeRssItem(item, sourceName))
    }

    // Atom 1.0
    const atomEntries = parsed?.feed?.entry
    if (atomEntries) {
      const list = Array.isArray(atomEntries) ? atomEntries : [atomEntries]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return list.slice(0, maxResults).map((entry: any) => normalizeAtomEntry(entry, sourceName))
    }

    console.warn(`[rss] ${sourceName} → feed shape unrecognized`)
    return []
  } catch (err) {
    console.error(`[rss] ${sourceName} → fetch failed:`, err)
    return []
  }
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
