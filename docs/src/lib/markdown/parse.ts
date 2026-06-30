/**
 * A small, zero-dependency Markdown parser → a serializable block AST.
 *
 * Scope (v1): headings, paragraphs, unordered/ordered lists, blockquotes, thematic
 * breaks, fenced code (``` or ~~~), and three docs directives — `:::callout`,
 * `:::demo`, `:::tabs`. Inline: **strong**, *em*, `code`, and [links](url).
 *
 * It only produces data. The renderer ({@link ./render}) turns this AST into DOM,
 * always setting text via textContent — which is how the docs sidestep Weave's
 * "template text doesn't decode HTML entities" rule for code containing `<`, `{`, …
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export interface CodeTabData {
  label: string;
  lang: string;
  code: string;
}

export type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'hr' }
  | { type: 'code'; lang: string; code: string }
  | { type: 'callout'; kind: string; title: string; children: Block[] }
  | { type: 'demo'; component: string }
  | { type: 'tabs'; tabs: CodeTabData[] };

/** Flatten inline tokens to their plain text (for headings, anchors, snippets). */
export function inlineText(nodes: Inline[]): string {
  let s = '';
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'code') s += n.v;
    else s += inlineText(n.c);
  }
  return s;
}

const INLINE_RE =
  /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/;

/** Parse a single line of inline markdown into a token list. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  const pushText = (txt: string): void => {
    if (txt) out.push({ t: 'text', v: txt });
  };

  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      pushText(rest);
      break;
    }
    pushText(rest.slice(0, m.index));
    if (m[1]) out.push({ t: 'strong', c: parseInline(m[2]) });
    else if (m[3]) out.push({ t: 'em', c: parseInline(m[4]) });
    else if (m[5]) out.push({ t: 'code', v: m[6] }); // raw — special chars preserved
    else if (m[7]) out.push({ t: 'link', href: m[9], c: parseInline(m[8]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const FENCE_RE = /^(```|~~~)(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;
const DIRECTIVE_RE = /^:::\s*(\w+)\s*(.*)$/;
const TITLE_RE = /"([^"]*)"/;

/** Parse a markdown document into a block AST. */
export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code (``` or ~~~).
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].trim().split(/\s+/)[0] || 'text';
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trimEnd() !== marker) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ type: 'code', lang, code: body.join('\n') });
      continue;
    }

    // Directive: ::: name args ... :::
    const dir = DIRECTIVE_RE.exec(line);
    if (dir) {
      const name = dir[1];
      const args = dir[2].trim();
      // Single-line demo: `:::demo counter` needs no body/close.
      if (name === 'demo') {
        i++;
        if (lines[i]?.trim() === ':::') i++; // tolerate an explicit close
        blocks.push({ type: 'demo', component: args.split(/\s+/)[0] });
        continue;
      }
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') {
        bodyLines.push(lines[i]);
        i++;
      }
      i++; // consume closing :::
      if (name === 'tabs') {
        blocks.push({ type: 'tabs', tabs: parseTabs(bodyLines) });
      } else {
        // callout (default): args = "<kind> [\"title\"]"
        const kind = args.split(/\s+/)[0] || 'info';
        const title = TITLE_RE.exec(args)?.[1] ?? '';
        blocks.push({ type: 'callout', kind, title, children: parse(bodyLines.join('\n')) });
      }
      continue;
    }

    // Heading.
    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, inline: parseInline(h[2]) });
      i++;
      continue;
    }

    // Thematic break.
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote — gather '>' lines, parse the stripped content recursively.
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', children: parse(quoted.join('\n')) });
      continue;
    }

    // List (unordered or ordered) — gather consecutive item lines.
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && (UL_RE.test(lines[i]) || OL_RE.test(lines[i]))) {
        const m = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i]);
        items.push(parseInline((m?.[1] ?? '').trim()));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph — gather until a blank line or a new block starter.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', inline: parseInline(para.join(' ').trim()) });
  }

  return blocks;
}

/** Does a line begin a non-paragraph block? (Stops paragraph accumulation.) */
function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    DIRECTIVE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    /^>\s?/.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line)
  );
}

/** Inside a `:::tabs` block: turn each fenced code block into a tab. The fence
 *  info string may carry a label, e.g. ~~~ts title="counter.ts". */
function parseTabs(lines: string[]): CodeTabData[] {
  const tabs: CodeTabData[] = [];
  let i = 0;
  while (i < lines.length) {
    const fence = FENCE_RE.exec(lines[i]);
    if (!fence) {
      i++;
      continue;
    }
    const marker = fence[1];
    const info = fence[2].trim();
    const lang = info.split(/\s+/)[0] || 'text';
    const label = TITLE_RE.exec(info)?.[1] ?? lang;
    const body: string[] = [];
    i++;
    while (i < lines.length && lines[i].trimEnd() !== marker) {
      body.push(lines[i]);
      i++;
    }
    i++;
    tabs.push({ label, lang, code: body.join('\n') });
  }
  return tabs;
}
