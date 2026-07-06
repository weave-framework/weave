/**
 * `@@` is Weave's escape for a literal `@` in template text. The compiler's parser DECODES it
 * (`@@if` → the text `@if`), so when the printer emits a text node it must RE-ESCAPE any `@` that
 * would otherwise be read back as a control-flow block keyword — otherwise a round-trip would turn
 * displayed prose like `@if` into a live `@if` block. The keyword list mirrors `BLOCK_KW` in
 * `packages/compiler/src/parser.ts`.
 */
const BLOCK_KW: string =
  'if|else|for|empty|switch|case|default|let|defer|placeholder|await|then|catch|snippet|render|key';

const AT_BEFORE_KEYWORD: RegExp = new RegExp(`@(?=(?:${BLOCK_KW})\\b)`, 'g');

/** Re-escape a leading-`@` that would be mis-read as a block (`@if` → `@@if`). */
export function escapeAt(text: string): string {
  return text.replace(AT_BEFORE_KEYWORD, '@@');
}
