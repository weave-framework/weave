/**
 * The search ranker: scores index entries against a query with three tiers —
 * direct (title hit), token (all words present), and fuzzy (subsequence). A small
 * synonym map adds "related" results so a search for "state" also surfaces the
 * store, "translation" surfaces i18n, etc. — the "suggest what might be related"
 * behavior from the docs vision.
 */

import type { SearchEntry } from './build-index';

export interface Result {
  entry: SearchEntry;
  score: number;
  /** True when the match was indirect (synonym/snippet/fuzzy) — shown apart. */
  related: boolean;
}

/** query term → related terms to also look for. */
const SYNONYMS: Record<string, string[]> = {
  state: ['store', 'signal'],
  store: ['state'],
  reactive: ['signal', 'computed', 'effect'],
  reactivity: ['signal', 'computed', 'effect'],
  derived: ['computed'],
  memo: ['computed'],
  translation: ['i18n', 'locale'],
  translations: ['i18n', 'locale'],
  i18n: ['translation', 'locale'],
  localization: ['i18n', 'locale'],
  routing: ['router', 'route', 'link', 'navigation'],
  navigation: ['router', 'link'],
  form: ['validation', 'field', 'input'],
  forms: ['validation', 'field', 'input'],
  validation: ['form', 'field'],
  animation: ['transition', 'motion'],
  animations: ['transition', 'motion'],
  motion: ['transition'],
  component: ['setup', 'props', 'slot'],
  components: ['setup', 'props', 'slot'],
  lifecycle: ['onmount', 'oncleanup', 'effect'],
  context: ['provide', 'inject'],
  di: ['provide', 'inject', 'context', 'store'],
  service: ['store', 'provide', 'inject'],
  template: ['binding', 'interpolation', 'directive'],
  event: ['on', 'listener', 'handler'],
};

/** Fuzzy subsequence score: are all of q's chars in `text` in order? Rewards
 *  early, consecutive matches. Returns 0 when not a subsequence. */
function fuzzy(text: string, q: string): number {
  let ti = 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  let firstHit = -1;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) {
      if (firstHit < 0) firstHit = ti;
      streak += 1;
      score += 1 + streak; // consecutive chars compound
      qi += 1;
    } else {
      streak = 0;
    }
    ti += 1;
  }
  if (qi < q.length) return 0; // not all chars matched
  // Prefer matches that start early in the string.
  return score - firstHit * 0.1;
}

/** Best score for one entry against the (already lowercased) query + its terms. */
function scoreEntry(entry: SearchEntry, q: string, terms: string[]): Result | null {
  const title = entry.title.toLowerCase();
  const kw = entry.keywords;
  const snippet = entry.snippet.toLowerCase();

  // Direct title hits (best).
  if (title === q) return { entry, score: 1000, related: false };
  if (title.startsWith(q)) return { entry, score: 850, related: false };
  if (title.includes(q)) return { entry, score: 700, related: false };

  // All query words present across title + keywords → strong, direct.
  const words = q.split(/\s+/).filter(Boolean);
  const hay = `${title} ${kw}`;
  if (words.length > 1 && words.every((w) => hay.includes(w))) {
    return { entry, score: 600, related: false };
  }

  // Fuzzy subsequence on the title — strict enough that sparse, scattered
  // matches don't count as a direct hit (they fall through to "related" below).
  const f = fuzzy(title, q);
  if (f >= q.length * 2.4) return { entry, score: 300 + f, related: false };

  // Keyword substring → direct but weaker.
  if (kw.includes(q)) return { entry, score: 320, related: false };

  // Synonym / related: a related term shows up in title or keywords.
  for (const t of terms) {
    if (t === q) continue;
    if (title.includes(t)) return { entry, score: 260, related: true };
    if (kw.includes(t)) return { entry, score: 200, related: true };
  }

  // Snippet mention → related, weakest.
  if (snippet.includes(q)) return { entry, score: 150, related: true };
  if (f > 0) return { entry, score: 80 + f, related: true };

  return null;
}

/** Rank entries for a query. Returns the top results, direct ones first. */
export function search(entries: SearchEntry[], query: string, limit = 12): Result[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const terms = [q, ...(SYNONYMS[q] ?? []), ...q.split(/\s+/).flatMap((w) => SYNONYMS[w] ?? [])];

  const results: Result[] = [];
  for (const entry of entries) {
    const r = scoreEntry(entry, q, terms);
    if (r) results.push(r);
  }

  results.sort((a, b) => {
    if (a.related !== b.related) return a.related ? 1 : -1; // direct before related
    return b.score - a.score;
  });
  return results.slice(0, limit);
}
