/** Scroll to an element by id, retrying briefly — markdown content is appended
 *  asynchronously (DocPage's onMount), so the anchor target may not exist yet at
 *  navigation time. Gives up after a few tries. */
export function scrollToHash(hash: string, tries = 10): void {
  const id = hash.replace(/^#/, '');
  if (!id) return;
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (tries > 0) setTimeout(() => scrollToHash(id, tries - 1), 50);
}
