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
