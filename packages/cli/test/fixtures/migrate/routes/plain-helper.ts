// No Angular anywhere: this really is plain TypeScript, and the carried banner may say so.
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}
