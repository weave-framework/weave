/**
 * Render a markdown block AST ({@link ./parse}) into real DOM.
 *
 * Two principles make this robust and on-brand:
 *  1. Every piece of text is set with `document.createTextNode` / `textContent`, so
 *     code containing `<`, `{`, `&` renders literally — no entity decoding needed.
 *  2. Doc widgets reuse the existing Weave components by *calling them as functions*
 *     (`CodeBlock(props)` returns a Node), and live demos are mounted from the
 *     registry — so an example on the page is the real, running component.
 */

import { navigate } from '@weave-framework/router';
import { inlineText, type Block, type Inline } from './parse';
import { slugify } from '../util/slug';
import { demos } from './registry';
import CodeTabs from '../code-tabs/code-tabs';
import Callout from '../callout/callout';
import Demo from '../demo/demo';

/** Friendly tab label for a lone code fence's language (e.g. `ts` → `TS`). */
const LANG_LABELS: Record<string, string> = {
  ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', html: 'HTML', scss: 'SCSS',
  css: 'CSS', json: 'JSON', bash: 'Bash', sh: 'Shell', text: 'Text',
};
const langLabel = (lang: string): string => LANG_LABELS[lang] ?? lang.toUpperCase();

/** Render inline tokens into a fragment of text + formatting nodes. */
function renderInline(nodes: Inline[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    if (n.t === 'text') {
      frag.append(document.createTextNode(n.v));
    } else if (n.t === 'strong') {
      const e = document.createElement('strong');
      e.append(renderInline(n.c));
      frag.append(e);
    } else if (n.t === 'em') {
      const e = document.createElement('em');
      e.append(renderInline(n.c));
      frag.append(e);
    } else if (n.t === 'code') {
      const e = document.createElement('code');
      e.textContent = n.v; // literal — no entity issues
      frag.append(e);
    } else if (n.t === 'link') {
      frag.append(renderLink(n.href, renderInline(n.c)));
    }
  }
  return frag;
}

/** Internal links (starting with '/') navigate client-side; others open in a tab. */
function renderLink(href: string, kids: Node): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  a.append(kids);
  if (href.startsWith('/')) {
    a.addEventListener('click', (e) => {
      const me = e as MouseEvent;
      if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
      e.preventDefault();
      navigate(href);
    });
  } else if (/^https?:/.test(href)) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  return a;
}

/** Render one block to a Node. */
function renderBlock(b: Block): Node {
  switch (b.type) {
    case 'heading': {
      const e = document.createElement(`h${b.level}`);
      e.id = slugify(inlineText(b.inline)); // anchor target for deep links + search
      e.append(renderInline(b.inline));
      return e;
    }
    case 'paragraph': {
      const e = document.createElement('p');
      e.append(renderInline(b.inline));
      return e;
    }
    case 'list': {
      const e = document.createElement(b.ordered ? 'ol' : 'ul');
      for (const item of b.items) {
        const li = document.createElement('li');
        li.append(renderInline(item));
        e.append(li);
      }
      return e;
    }
    case 'quote': {
      const e = document.createElement('blockquote');
      e.append(renderBlocks(b.children));
      return e;
    }
    case 'hr':
      return document.createElement('hr');
    case 'code':
      // Every code sample renders through the same Weave-UI Tabs — a lone snippet is a
      // one-tab group whose label is its language (so the label never overlaps Copy).
      return CodeTabs({ tabs: [{ label: langLabel(b.lang), lang: b.lang, code: b.code }] });
    case 'tabs':
      return CodeTabs({ tabs: b.tabs });
    case 'callout':
      return Callout(
        { kind: b.kind, title: b.title },
        { default: () => renderBlocks(b.children) },
      );
    case 'demo': {
      const Comp = demos[b.component];
      if (!Comp) {
        const warn = document.createElement('p');
        warn.textContent = `[missing demo: "${b.component}"]`;
        return warn;
      }
      return Demo({}, { default: () => Comp() });
    }
    case 'table': {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      b.header.forEach((cell, c) => {
        const th = document.createElement('th');
        if (b.align[c]) th.style.textAlign = b.align[c] as string;
        th.append(renderInline(cell));
        htr.append(th);
      });
      thead.append(htr);
      table.append(thead);
      const tbody = document.createElement('tbody');
      for (const row of b.rows) {
        const tr = document.createElement('tr');
        row.forEach((cell, c) => {
          const td = document.createElement('td');
          if (b.align[c]) td.style.textAlign = b.align[c] as string;
          td.append(renderInline(cell));
          tr.append(td);
        });
        tbody.append(tr);
      }
      table.append(tbody);
      return table;
    }
  }
}

/** Render a list of blocks into a fragment. */
function renderBlocks(blocks: Block[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const b of blocks) frag.append(renderBlock(b));
  return frag;
}

/** Public entry: render a whole block AST into a fragment. */
export function renderDoc(blocks: Block[]): DocumentFragment {
  return renderBlocks(blocks);
}
