/**
 * Generate the built-in Lucide icon set for @weave-framework/ui.
 *
 * Fetches the needed Lucide SVGs (ISC-licensed) from the CDN and emits
 * packages/ui/src/icon/lucide-icons.ts — a name → inner-markup registry the Icon
 * component seeds as the default "weave" set. We copy the SVG source (not an npm
 * dependency), so rule #1 (zero third-party runtime deps) holds. Attribution kept
 * in the emitted header + docs. Re-run to refresh/extend the set.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = [
  // arrows + chevrons (all variants)
  'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
  'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
  'chevrons-left', 'chevrons-right', 'chevrons-up-down',
  // core UI
  'house', 'menu', 'search', 'settings', 'ellipsis', 'ellipsis-vertical',
  'x', 'check', 'plus', 'minus',
  // people / comms
  'user', 'mail', 'bell', 'message-circle', 'share-2',
  // commerce / social
  'shopping-cart', 'heart', 'star',
  // actions
  'trash-2', 'pencil', 'paperclip', 'cloud-upload', 'cloud-download',
  'eye', 'eye-off', 'lock', 'lock-open',
  // status / feedback
  'info', 'circle-check', 'circle-alert', 'circle-x', 'triangle-alert',
  // logistics
  'truck',
  // component-essential (checkbox indeterminate, datepicker, timepicker)
  'calendar', 'clock',
  // theme + chrome (docs top bar, code blocks, repo link)
  // NB: Lucide dropped brand marks (no 'github'); use the neutral 'git-branch' for repos.
  'sun', 'moon', 'git-branch', 'copy',
  // section / nav glyphs
  'graduation-cap', 'book-open', 'package',
];

const CDN = 'https://unpkg.com/lucide-static@latest/icons';

// Strip HTML comments to a fixpoint — a single pass can leave a `<!--` behind
// (e.g. `<!--<!-- -->-->`), which is an incomplete-sanitization shape.
function stripComments(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  } while (s !== prev);
  return s;
}

function extractInner(svg) {
  return stripComments(svg) // license comment(s)
    .replace(/<svg[\s\S]*?>/, '') // opening <svg …>
    .replace(/<\/svg>/, '') // closing </svg>
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/> </g, '><')
    .trim();
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'packages', 'ui', 'src', 'icon', 'lucide-icons.ts');

const entries = [];
for (const name of NAMES) {
  const res = await fetch(`${CDN}/${name}.svg`);
  if (!res.ok) {
    console.error(`✖ ${name}: HTTP ${res.status}`);
    process.exit(1);
  }
  const inner = extractInner(await res.text());
  entries.push([name, inner]);
  console.log(`  ✔ ${name}`);
}

const body = entries.map(([name, inner]) => `  '${name}': ${JSON.stringify(inner)},`).join('\n');

const file = `/**
 * Built-in icon set for @weave-framework/ui — a curated subset of Lucide
 * (https://lucide.dev), ISC-licensed. Copyright (c) Lucide Contributors.
 *
 * Inner SVG markup only; the Icon component wraps it in an <svg viewBox="0 0 24 24"
 * fill="none" stroke="currentColor" stroke-width="var(--weave-icon-stroke)" …>. This
 * is the default "weave" set our components rely on; apps replace/extend it via
 * configureIcons(). Regenerate with: node tools/gen-lucide-icons.mjs
 */
export const lucideIcons: Record<string, string> = {
${body}
};
`;

writeFileSync(out, file);
console.log(`\nWrote ${entries.length} icons → ${out}`);
