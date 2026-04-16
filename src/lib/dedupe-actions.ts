/**
 * Daily Actions deduplication (Task 7).
 *
 * A contact should never appear more than once in the Daily Actions tab
 * (or email digest) on the same day. If multiple scored articles match
 * the same contact with score >= 7, we keep only the single most relevant
 * one — measured by the same composite rank used for the top-5 cap.
 *
 * Composite rank (matches buildActionItems in /api/daily-brief):
 *   relevance_score * 2 + contact_match_score + status_boost
 *   where status_boost = 3 (Active), 2 (Warm), 0 (Cold/Dormant)
 */

export interface RankableAction<T> {
  item: T
  contact_id: string | null
  relevance_score: number
  contact_match_score: number
  status: string | null // 'Active' | 'Warm' | 'Cold' | 'Dormant' | null
}

function computeRank(a: RankableAction<unknown>): number {
  const statusBoost =
    a.status === 'Active' ? 3 : a.status === 'Warm' ? 2 : 0
  return a.relevance_score * 2 + a.contact_match_score + statusBoost
}

/**
 * Given a list of contact-matched action candidates (already filtered to
 * contact_match_score >= 7 and contact_id present), keep only the
 * single highest-ranked candidate per contact_id. Ties are broken by
 * the original input order (stable).
 *
 * Returns the deduplicated list ranked desc by composite score, ready
 * for the caller to apply its top-5 / Cold-cap logic.
 */
export function dedupeActionsByContact<T>(
  candidates: RankableAction<T>[]
): RankableAction<T>[] {
  const bestByContact = new Map<string, { entry: RankableAction<T>; rank: number }>()

  for (const candidate of candidates) {
    if (!candidate.contact_id) continue // shouldn't happen, but be defensive
    const rank = computeRank(candidate)
    const existing = bestByContact.get(candidate.contact_id)
    if (!existing || rank > existing.rank) {
      bestByContact.set(candidate.contact_id, { entry: candidate, rank })
    }
  }

  return Array.from(bestByContact.values())
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.entry)
}
