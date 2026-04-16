import type { NewsItem } from './news-fetcher'

/**
 * Article deduplication for the Daily Brief pipeline (Task 8).
 *
 * Why the previous version failed
 * ────────────────────────────────
 * The old greedy-Jaccard dedup used `overlap / Math.min(setA, setB)` with
 * threshold 0.5 over words length > 3. For two real-world Dupixent stories:
 *
 *   A: "FDA approves Dupixent for atopic dermatitis in children aged 6 months"
 *   B: "Sanofi and Regeneron's Dupixent receives pediatric eczema approval"
 *
 * Significant overlap was just {dupixent}. min(7, 7) = 7. Score 1/7 ≈ 0.14
 * → not merged. Same news event, two rows in the brief.
 *
 * What's different here
 * ─────────────────────
 * 1. Title normalization: strip Google-News-style publisher suffixes
 *    ("FDA approves… - Reuters") and trailing ellipses.
 * 2. Token extraction returns BOTH a "significant" set (length ≥ 3,
 *    non-stopword, lightly stemmed) AND a "proper noun anchor" set
 *    (capitalized tokens — including position-0 — plus all-caps
 *    abbreviations like FDA, CMS, IPO, kept un-stemmed).
 * 3. Light stemming on significant tokens collapses "approves" /
 *    "approval" / "approved" → "approv". This catches paraphrased
 *    headlines where the only common verb is in different forms.
 * 4. Proper anchors are split into RARE (length ≥ 6 and not a common
 *    brand component like "health" / "care" / "group") and COMMON.
 * 5. Two articles match if ANY of:
 *    a) Shared rare proper anchor + ≥1 other shared stem
 *       → catches "Sanofi's Dupixent receives approval" vs
 *         "FDA approves Dupixent for atopic dermatitis"
 *         (shared rare {dupixent} + shared stem {approv})
 *    b) Shared common proper anchor + ≥2 other shared stems
 *       → catches "CMS finalizes 2026 Medicare Advantage rates" vs
 *         "Medicare Advantage 2026 final rate notice from CMS"
 *         but not "Apple Health adds sleep" vs "Apple announces fitness"
 *    c) Classic Jaccard ≥ 0.4 over significant stems (lowered from 0.5).
 * 6. After the first greedy pass, run a merge-until-stable pass that
 *    catches transitive overlaps the greedy pass missed (A merged B,
 *    then later C also matches A's new representative).
 * 7. Tier-aware: when groups merge, the lower-numbered (= higher-quality)
 *    source survives as the representative.
 */

interface Group {
  representative: NewsItem
  tier: number
  // Cached tokens for the representative — re-extracted whenever the rep changes.
  proper: Set<string>
  rareProper: Set<string>
  significant: Set<string>
}

// Strip Google-News-style and similar publisher suffixes:
//   "Foo bar - Reuters", "Foo bar | STAT News", "Foo bar — Bloomberg"
// Also drop trailing ellipses.
const PUBLISHER_SUFFIX_RE =
  /\s*[-—|·]\s*(Reuters|STAT(?:\s+News)?|Bloomberg|TechCrunch|Forbes|Modern\s+Healthcare|Fierce\s+Healthcare|FierceHealthcare|MedCity\s+News|MedCityNews|Axios|WSJ|Wall\s+Street\s+Journal|Business\s+Insider|FinSMEs|PR\s+Newswire|GlobeNewswire|Business\s+Wire|BusinessWire|MobiHealthNews|Healthcare\s+IT\s+News)\s*$/i

function normalizeTitle(title: string): string {
  return title.replace(PUBLISHER_SUFFIX_RE, '').replace(/\.{3,}\s*$/, '').replace(/\s+/g, ' ').trim()
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into',
  'after', 'before', 'over', 'under', 'about', 'against', 'between',
  'will', 'would', 'could', 'should', 'have', 'has', 'had', 'been',
  'being', 'are', 'was', 'were', 'as', 'on', 'in', 'at', 'by', 'of', 'to',
  'an', 'is', 'it', 'be', 'or', 'but', 'not', 'no', 'so', 'if',
  'says', 'said', 'new', 'gets', 'get', 'now', 'amid', 'than', 'then',
  'who', 'what', 'when', 'where', 'why', 'how', 'its', 'their', 'our',
  'his', 'her', 'they', 'them', 'these', 'those',
])

// Words that are commonly capitalized as part of a brand but aren't
// distinctive enough to anchor a story-merge (e.g. "Apple Health" /
// "Devoted Health" / "Hims Health" all contain "Health"). Also excluded
// from the "other shared" count in Rule A so two stories about Devoted
// Health that share only the brand don't get falsely merged.
//
// Also includes generic funding-news vocabulary (series / fund / funding /
// million / billion) — without this, "X raises $50M Series C" tends to
// merge with any other "Y raises $300M Series E" via shared {series, rais}.
const COMMON_BRAND_COMPONENTS = new Set([
  'health', 'medical', 'care', 'group', 'corp', 'company', 'companies',
  'systems', 'system', 'partners', 'capital', 'ventures', 'global',
  'international', 'solutions', 'services', 'industries', 'pharma',
  'pharmaceuticals', 'biotech', 'therapeutics', 'sciences', 'technologies',
  'tech', 'inc', 'llc', 'ltd', 'plc', 'holdings', 'enterprises',
  'clinic', 'clinics', 'hospital', 'hospitals', 'lab', 'labs',
  // Generic funding/news vocabulary
  'series', 'fund', 'funds', 'funding', 'million', 'billion',
])

// Crude suffix-stripper. Tries longest suffixes first, requires stem ≥ 4 chars,
// single pass. Excluded -er/-ers because "founder" → "found" actively destroys
// meaning. The 4-char minimum prevents "raises" → "rais" → "rai" runaway.
const STEM_SUFFIXES = [
  'izations', 'ization', 'ations', 'ation', 'tions', 'tion',
  'ings', 'ions', 'ion', 'ing', 'ies', 'ied', 'als',
  'al', 'ed', 'es', 'ly', 's',
]

function stem(word: string): string {
  for (const suf of STEM_SUFFIXES) {
    if (word.length - suf.length >= 4 && word.endsWith(suf)) {
      return word.slice(0, -suf.length)
    }
  }
  return word
}

// Pre-computed stems of every common-brand-component word. The significant
// token set holds stems, so when we filter "common" stems out of significant
// we need to compare against stems too — not against the raw COMMON entries.
let STEMMED_COMMON: Set<string> | null = null
function getStemmedCommon(): Set<string> {
  if (STEMMED_COMMON) return STEMMED_COMMON
  const s = new Set<string>()
  for (const w of COMMON_BRAND_COMPONENTS) {
    s.add(w)
    s.add(stem(w))
  }
  STEMMED_COMMON = s
  return s
}

interface Tokens {
  proper: Set<string>      // all proper anchors (lowercased, un-stemmed)
  rareProper: Set<string>  // proper anchors that are length ≥ 6 and not a common brand component
  significant: Set<string> // significant words, stemmed
}

function extractTokens(originalTitle: string): Tokens {
  const normalized = normalizeTitle(originalTitle)
  // Split on whitespace + common punctuation, keep apostrophes for contractions.
  const rawWords = normalized.split(/[\s\-—:,;.!?()"]+/).filter(Boolean)

  const proper = new Set<string>()
  const rareProper = new Set<string>()
  const significant = new Set<string>()

  for (const w of rawWords) {
    // Strip non-alphanumeric (drops trailing 's, &, etc.)
    const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!lower || STOPWORDS.has(lower)) continue
    if (lower.length < 3) continue

    significant.add(stem(lower))

    // Proper-noun anchor heuristic — INCLUDES sentence-initial capitalized
    // words (a previous version's i>0 check dropped Dupixent / Sanofi when
    // they led the headline). The STOPWORDS filter above keeps "The" / "A"
    // out anyway.
    const isAllCaps =
      w === w.toUpperCase() && w.length >= 2 && w.length <= 5 && /^[A-Z]+$/.test(w)
    const isCapitalized = /^[A-Z]/.test(w)

    if (isAllCaps || isCapitalized) {
      proper.add(lower)
      // A proper noun is "rare" (distinctive) when it's at least 6 chars
      // long AND isn't a generic brand component.
      if (lower.length >= 6 && !COMMON_BRAND_COMPONENTS.has(lower)) {
        rareProper.add(lower)
      }
      // Acronyms like FDA / CMS are also distinctive, even at length 3.
      if (isAllCaps) {
        rareProper.add(lower)
      }
    }
  }

  return { proper, rareProper, significant }
}

function titlesAreSimilar(a: Tokens, b: Tokens): boolean {
  const stemmedCommon = getStemmedCommon()

  // Count of shared significant stems, optionally excluding common brand
  // components (so "Devoted Health raises $300M" vs "Devoted Health
  // appoints CEO" don't merge on the back of a shared {devoted, health}).
  // Significant holds STEMS, so we compare against the pre-stemmed common set.
  const countSharedSignificant = (
    excluded: Set<string>,
    excludeCommonBrand: boolean
  ): number => {
    let c = 0
    for (const w of a.significant) {
      if (!b.significant.has(w)) continue
      if (excluded.has(w)) continue
      if (excludeCommonBrand && stemmedCommon.has(w)) continue
      c++
    }
    return c
  }

  // Rule A: shared RARE proper anchor + at least 1 other shared significant
  // stem (excluding common brand words). Catches:
  //   "FDA approves Dupixent…" vs "Sanofi's Dupixent receives approval" →
  //   shared rare {dupixent} + shared stem {approv}
  let hasSharedRare = false
  const sharedRareStems = new Set<string>()
  for (const rp of a.rareProper) {
    if (b.rareProper.has(rp)) {
      hasSharedRare = true
      sharedRareStems.add(stem(rp))
    }
  }
  if (hasSharedRare && countSharedSignificant(sharedRareStems, true) >= 1) {
    return true
  }

  // Rule B: at least 2 shared COMMON proper anchors + at least 2 other shared
  // significant stems (also excluding common brand words). Requires 2 anchors
  // (not 1) so a single shared generic like "Series" can't trigger merges
  // between unrelated funding stories.
  let sharedCommonProperCount = 0
  const sharedCommonStems = new Set<string>()
  for (const p of a.proper) {
    if (b.proper.has(p) && !a.rareProper.has(p)) {
      sharedCommonProperCount++
      sharedCommonStems.add(stem(p))
    }
  }
  if (
    sharedCommonProperCount >= 2 &&
    countSharedSignificant(sharedCommonStems, true) >= 2
  ) {
    return true
  }

  // Rule C: classic Jaccard-style overlap on significant stems, threshold 0.5.
  // Common brand/generic STEMS are EXCLUDED on both sides before computing
  // overlap — without this, two short headlines like
  //   "Devoted Health raises $300M Series E"
  //   "Carbon Health raises $150M Series D"
  // hit ~0.6 Jaccard purely on generic vocab and falsely merge.
  let aSize = 0
  let bSize = 0
  let overlap = 0
  for (const w of a.significant) {
    if (stemmedCommon.has(w)) continue
    aSize++
    if (b.significant.has(w)) overlap++
  }
  for (const w of b.significant) {
    if (stemmedCommon.has(w)) continue
    bSize++
  }
  const denom = Math.min(aSize, bSize)
  if (denom > 0 && overlap / denom >= 0.5) return true

  return false
}

interface DedupeResult {
  articles: NewsItem[]
  raw_count: number
  unique_count: number
  merges: number
}

export function deduplicateArticles(
  articles: NewsItem[],
  getSourceTier: (source: string) => number
): DedupeResult {
  const groups: Group[] = []
  let mergeCount = 0

  // Pass 1: greedy grouping
  for (const article of articles) {
    const tokens = extractTokens(article.title)
    let merged = false

    for (const group of groups) {
      if (
        titlesAreSimilar(tokens, {
          proper: group.proper,
          rareProper: group.rareProper,
          significant: group.significant,
        })
      ) {
        const articleTier = getSourceTier(article.source)
        if (articleTier < group.tier) {
          // Promote: better source becomes the new representative
          group.representative = article
          group.tier = articleTier
          group.proper = tokens.proper
          group.rareProper = tokens.rareProper
          group.significant = tokens.significant
        }
        mergeCount++
        merged = true
        break
      }
    }

    if (!merged) {
      groups.push({
        representative: article,
        tier: getSourceTier(article.source),
        proper: tokens.proper,
        rareProper: tokens.rareProper,
        significant: tokens.significant,
      })
    }
  }

  // Pass 2: merge-until-stable. The greedy first pass can leave two groups
  // unmerged when their representatives weren't the first pair seen — e.g.
  // article A formed group α, article B (slightly different wording) formed
  // group β, then article C matched A and joined α but never tested against β.
  // Walk pairs and merge until nothing changes.
  let changed = true
  while (changed && groups.length > 1) {
    changed = false
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const gi = groups[i]
        const gj = groups[j]
        if (
          titlesAreSimilar(
            { proper: gi.proper, rareProper: gi.rareProper, significant: gi.significant },
            { proper: gj.proper, rareProper: gj.rareProper, significant: gj.significant }
          )
        ) {
          // Keep the lower-tier (better source) representative
          if (gj.tier < gi.tier) {
            gi.representative = gj.representative
            gi.tier = gj.tier
            gi.proper = gj.proper
            gi.rareProper = gj.rareProper
            gi.significant = gj.significant
          }
          groups.splice(j, 1)
          mergeCount++
          changed = true
          break outer
        }
      }
    }
  }

  return {
    articles: groups.map((g) => g.representative),
    raw_count: articles.length,
    unique_count: groups.length,
    merges: mergeCount,
  }
}
