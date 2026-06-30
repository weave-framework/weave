import { signal, effect, type Signal } from '@weave-framework/runtime';
import { highlight } from '../highlight/highlight';

interface CodeBlockProps {
  /** The source to display and copy. */
  code?: string;
  /** Language tag shown in the corner and used for highlighting. */
  lang?: string;
}

interface CodeBlockSetup {
  lang: () => string;
  label: () => string;
  copy: () => void;
  /** The <code> element, captured by ref so the effect can fill it. */
  codeEl: Signal<Element | null>;
}

/** A single copyable, syntax-highlighted code snippet. */
export function setup(props: CodeBlockProps): CodeBlockSetup {
  const code = (): string => props.code ?? '';
  const lang = (): string => props.lang ?? 'ts';
  const label = signal('Copy');
  const codeEl = signal<Element | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Re-highlight whenever the element appears OR the code/lang change — so a
  // reactive `code` prop (e.g. switching CodeTabs) updates, not just the first
  // render. Text is rebuilt with textContent/spans, so `<`/`{` stay literal.
  effect(() => {
    const el = codeEl();
    const c = code();
    const l = lang();
    if (!el) return;
    el.textContent = '';
    el.append(highlight(c, l));
  });

  const copy = (): void => {
    void navigator.clipboard?.writeText(code()).then(
      () => label.set('Copied!'),
      () => label.set('Press Ctrl+C'),
    );
    clearTimeout(timer);
    timer = setTimeout(() => label.set('Copy'), 1400);
  };

  return { lang, label, copy, codeEl };
}
