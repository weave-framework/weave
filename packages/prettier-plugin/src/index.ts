/**
 * `@weave-framework/prettier-plugin` — format Weave templates with Prettier.
 *
 * Formats `.weave` SFCs and Weave-template `.html` files ({{ }} interpolation, `@if/@for/@switch/…`
 * control flow, `on:`/`bind:`/`use:`/`class:`/`style:`/`ref` bindings) by reusing the Weave
 * compiler's parser, so the formatter can never drift from what actually compiles.
 *
 * `.weave` files are picked up automatically. Route Weave `.html` templates to this plugin with an
 * `overrides` entry so plain HTML elsewhere is unaffected:
 *
 *   {
 *     "plugins": ["@weave-framework/prettier-plugin"],
 *     "overrides": [{ "files": "path/to/weave-templates/**\/*.html", "options": { "parser": "weave" } }]
 *   }
 */
import type { Parser, Printer, SupportLanguage } from 'prettier';
import { parseWeave } from './parse.js';
import { printWeave } from './print.js';
import type { WeaveRoot } from './ast.js';

export const languages: SupportLanguage[] = [
  {
    name: 'Weave',
    parsers: ['weave'],
    extensions: ['.weave'],
    vscodeLanguageIds: ['weave'],
  },
];

export const parsers: Record<string, Parser<WeaveRoot>> = {
  weave: {
    parse: (text, options) => parseWeave(text, options),
    astFormat: 'weave-ast',
    locStart: () => 0,
    locEnd: (node: WeaveRoot) => node.raw.length,
  },
};

export const printers: Record<string, Printer<WeaveRoot>> = {
  'weave-ast': {
    print: printWeave,
  },
};
