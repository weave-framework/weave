/** Turn heading text into a URL-/anchor-safe slug, e.g. "Thinking in signals"
 *  → "thinking-in-signals". Used for heading ids and search anchors. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // drop punctuation
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
