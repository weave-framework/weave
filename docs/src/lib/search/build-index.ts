/**
 * Builds the client-side search index from the navigation + the markdown content.
 * Runs once at module load — cheap, and keeps the index in sync with what's
 * actually shipped. Later, the API-reference generator can push symbol entries here.
 */

import { sections, type NavSection } from '../../nav';
import { content } from '../../content/content.gen';
import { parse, inlineText } from '../markdown/parse';
import { slugify } from '../util/slug';

export interface SearchEntry {
  /** What the result shows as its heading. */
  title: string;
  /** Where it navigates (may include a #anchor). */
  path: string;
  /** Section label, e.g. "Learn" — shown as a breadcrumb. */
  section: string;
  /** 'page' (a route) or 'heading' (a section within a page). */
  kind: 'page' | 'heading';
  /** A short text preview. */
  snippet: string;
  /** Lowercased terms used for matching (title words, headings, keywords). */
  keywords: string;
}

/** Which nav section does a path fall under? */
function sectionFor(path: string): NavSection | undefined {
  return sections.find((s) => path.startsWith(s.basePath));
}

function buildEntries(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const seenPaths = new Set<string>();

  // 1) Every nav item is a page entry (covers pages without markdown too).
  for (const section of sections) {
    for (const group of section.groups) {
      for (const item of group.items) {
        entries.push({
          title: item.label,
          path: item.path,
          section: section.label,
          kind: 'page',
          snippet: '',
          keywords: `${item.label} ${group.label} ${section.label}`.toLowerCase(),
        });
        seenPaths.add(item.path);
      }
    }
  }

  // 2) Walk each markdown page: enrich its page entry + add a heading entry per
  //    section heading (h2/h3) so search can jump straight to a sub-topic.
  for (const slug of Object.keys(content)) {
    const path = `/${slug}`;
    const section = sectionFor(path);
    const blocks = parse(content[slug]);

    // Page title + first-paragraph snippet from the markdown itself.
    const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
    const firstPara = blocks.find((b) => b.type === 'paragraph');
    const pageTitle = h1 && h1.type === 'heading' ? inlineText(h1.inline) : slug;
    const pageSnippet = firstPara && firstPara.type === 'paragraph' ? inlineText(firstPara.inline) : '';

    const pageEntry = entries.find((e) => e.path === path);
    if (pageEntry) {
      pageEntry.title = pageEntry.title || pageTitle;
      pageEntry.snippet = pageSnippet;
      pageEntry.keywords += ' ' + collectText(blocks).toLowerCase();
    } else if (!seenPaths.has(path)) {
      entries.push({
        title: pageTitle,
        path,
        section: section?.label ?? '',
        kind: 'page',
        snippet: pageSnippet,
        keywords: collectText(blocks).toLowerCase(),
      });
    }

    // Heading entries with anchors + the following paragraph as a snippet.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== 'heading' || b.level < 2) continue;
      const text = inlineText(b.inline);
      const next = blocks[i + 1];
      const snippet = next && next.type === 'paragraph' ? inlineText(next.inline) : '';
      entries.push({
        title: text,
        path: `${path}#${slugify(text)}`,
        section: section?.label ?? '',
        kind: 'heading',
        snippet,
        keywords: `${text} ${pageTitle}`.toLowerCase(),
      });
    }
  }

  return entries;
}

/** Concatenate the prose text of a block list (for keyword matching). */
function collectText(blocks: ReturnType<typeof parse>): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') parts.push(inlineText(b.inline));
    else if (b.type === 'list') for (const it of b.items) parts.push(inlineText(it));
    else if (b.type === 'callout') parts.push(collectText(b.children));
  }
  return parts.join(' ');
}

/** The search index — built once at startup. */
export const entries: SearchEntry[] = buildEntries();
