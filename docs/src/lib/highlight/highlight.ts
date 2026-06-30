/**
 * A tiny, zero-dependency syntax highlighter for the docs.
 *
 * NOT a TextMate engine (that needs oniguruma — a third-party dep, against rule #1).
 * Instead: per-language ordered regex rules, scanned with sticky matching. Good
 * enough to make TS, HTML, Weave templates, CSS, and JSON readable. Returns a DOM
 * fragment of <span class="tok-…"> + text nodes — text is set via textContent, so
 * code containing `<`, `{`, `&` stays literal.
 */

interface Rule {
  type: string;
  re: RegExp;
}

interface Token {
  type: string;
  value: string;
}

// NOTE: every rule uses the sticky flag `y`, which anchors the match at the
// scanner's current index — so NO `^` anchor (with `y`, `^` would only ever match
// at offset 0 and stall the tokenizer after the first token).
const TS_KEYWORD =
  /(?:import|from|export|default|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|implements|interface|type|enum|namespace|public|private|protected|readonly|static|abstract|async|await|yield|try|catch|finally|throw|typeof|instanceof|keyof|in|of|as|satisfies|is|void|never|unknown|any|null|undefined|true|false|this|super|delete)\b/y;

/** Shared TypeScript / JavaScript rules (order matters — first match wins). */
const TS_RULES: Rule[] = [
  { type: 'comment', re: /\/\/[^\n]*/y },
  { type: 'comment', re: /\/\*[\s\S]*?\*\//y },
  { type: 'string', re: /`(?:\\.|[^`\\])*`/y },
  { type: 'string', re: /'(?:\\.|[^'\\])*'/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"/y },
  { type: 'number', re: /\b\d[\d_]*(?:\.\d+)?\b/y },
  { type: 'keyword', re: TS_KEYWORD },
  { type: 'func', re: /[A-Za-z_$][\w$]*(?=\s*\()/y },
  { type: 'property', re: /(?<=\.)[A-Za-z_$][\w$]*/y },
  { type: 'ident', re: /[A-Za-z_$][\w$]*/y },
  { type: 'punct', re: /=>|\.\.\.|[{}()[\].,;:?]|[-+*/%<>=!&|~^]+/y },
];

/** HTML / Weave-template rules. Weave adds `{{ … }}` interpolation and `@block`
 *  control-flow keywords on top of HTML. */
const HTML_RULES: Rule[] = [
  { type: 'comment', re: /<!--[\s\S]*?-->/y },
  { type: 'interp', re: /\{\{[\s\S]*?\}\}/y },
  { type: 'keyword', re: /@(?:if|else if|else|for|empty|switch|case|default|let|defer|placeholder|loading|error|await|then|catch)\b/y },
  { type: 'tag', re: /<\/?[A-Za-z][\w:-]*/y },
  { type: 'tag', re: /\/?>/y },
  { type: 'attr', re: /[A-Za-z_@:][\w:.-]*(?=\s*=)/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
  { type: 'punct', re: /=/y },
];

/** CSS / SCSS rules. */
const CSS_RULES: Rule[] = [
  { type: 'comment', re: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y },
  { type: 'property', re: /[A-Za-z-]+(?=\s*:)/y },
  { type: 'number', re: /-?\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg)?\b/y },
  { type: 'func', re: /[A-Za-z-]+(?=\()/y },
  { type: 'tag', re: /[.#&][\w-]+/y },
  { type: 'punct', re: /[{}()[\];:,>]/y },
];

const JSON_RULES: Rule[] = [
  { type: 'property', re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"/y },
  { type: 'number', re: /-?\b\d[\d.eE+-]*\b/y },
  { type: 'keyword', re: /\b(?:true|false|null)\b/y },
  { type: 'punct', re: /[{}[\]:,]/y },
];

function rulesFor(lang: string): Rule[] | null {
  switch (lang) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return TS_RULES;
    case 'html':
    case 'weave':
    case 'xml':
      return HTML_RULES;
    case 'css':
    case 'scss':
      return CSS_RULES;
    case 'json':
      return JSON_RULES;
    default:
      return null; // plain text — no highlighting
  }
}

/** Tokenize a source string for a language. Unmatched runs become 'plain'. */
function tokenize(src: string, rules: Rule[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let plain = '';
  const flush = (): void => {
    if (plain) {
      tokens.push({ type: 'plain', value: plain });
      plain = '';
    }
  };

  outer: while (i < src.length) {
    for (const { type, re } of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m[0].length > 0) {
        flush();
        tokens.push({ type, value: m[0] });
        i += m[0].length;
        continue outer;
      }
    }
    plain += src[i++];
  }
  flush();
  return tokens;
}

/** Highlight `code` for `lang` into a DOM fragment of styled spans + text. */
export function highlight(code: string, lang: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const rules = rulesFor(lang);
  if (!rules) {
    frag.append(document.createTextNode(code));
    return frag;
  }
  for (const t of tokenize(code, rules)) {
    if (t.type === 'plain' || t.type === 'ident') {
      frag.append(document.createTextNode(t.value));
    } else {
      const span = document.createElement('span');
      span.className = `tok-${t.type}`;
      span.textContent = t.value;
      frag.append(span);
    }
  }
  return frag;
}
