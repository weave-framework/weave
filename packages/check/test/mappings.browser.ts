import { test, assert } from '../../../tools/harness.js';
// Import the emit module directly (not the package barrel) so the browser bundle
// stays free of the node-only `check.ts`/`project.ts` (typescript, node:fs).
import { buildVirtualSfc, buildVirtualSeparate, type Virtual, type WeaveMapping } from '../src/emit.js';

/** Newlines are flattened to spaces in generated expressions; compare modulo that. */
const norm = (s: string): string => s.replace(/[\r\n]/g, ' ');

/** Every mapping must quote identical text (modulo newlines) on both sides. */
function assertVerbatim(v: Virtual): void {
  for (const m of v.mappings) {
    const gen: string = v.text.slice(m.generatedOffset, m.generatedOffset + m.length);
    const srcText: string = m.source === 'script' ? v.scriptText : v.templateText;
    const src: string = srcText.slice(m.sourceOffset, m.sourceOffset + m.length);
    assert.equal(
      norm(gen),
      norm(src),
      `mapping (${m.source}) gen@${m.generatedOffset} "${gen}" != src@${m.sourceOffset} "${src}"`
    );
  }
}

/** Find the mapping whose source quotes exactly `needle` in the given region. */
function mapOf(v: Virtual, needle: string, source: WeaveMapping['source']): WeaveMapping | undefined {
  const srcText: string = source === 'script' ? v.scriptText : v.templateText;
  return v.mappings.find(
    (m) => m.source === source && srcText.slice(m.sourceOffset, m.sourceOffset + m.length) === needle
  );
}

test('mappings: SFC interpolation maps the expression to its template offset', () => {
  const src: string = [
    '<script>',
    'export function setup() { return { count: 1 }; }',
    '</script>',
    '<p>{{ count }}</p>',
  ].join('\n');
  const v: Virtual = buildVirtualSfc('Comp.weave', src);
  assertVerbatim(v);
  const m: WeaveMapping | undefined = mapOf(v, 'count', 'template');
  assert.ok(m, 'expected a template mapping quoting `count`');
  // points at the `count` inside `{{ count }}`
  assert.equal(src.slice(m!.sourceOffset, m!.sourceOffset + m!.length), 'count');
  // and at a `count` inside the generated module
  assert.equal(v.text.slice(m!.generatedOffset, m!.generatedOffset + m!.length), 'count');
});

test('mappings: the verbatim script region maps 1:1 to the SFC source', () => {
  const src: string = [
    '<script>',
    'export function setup() { return { title: "hi" }; }',
    '</script>',
    '<h1>{{ title }}</h1>',
  ].join('\n');
  const v: Virtual = buildVirtualSfc('Comp.weave', src);
  assertVerbatim(v);
  const sm: WeaveMapping | undefined = v.mappings.find((m) => m.source === 'script');
  assert.ok(sm, 'expected a script mapping');
  assert.equal(sm!.generatedOffset, 0, 'script is embedded at the top of the virtual module');
  // the mapped source span is exactly the trimmed <script> body
  assert.equal(src.slice(sm!.sourceOffset, sm!.sourceOffset + sm!.length).includes('export function setup'), true);
});

test('mappings: control-flow and child props all map to template offsets', () => {
  const src: string = [
    '<script>',
    'import Child from "./child";',
    'export function setup() { return { items: [1, 2], title: "x", Child }; }',
    '</script>',
    '<ul>',
    '  @for (n of items) {',
    '    <li>{{ n }}</li>',
    '  }',
    '</ul>',
    '<Child label={{title}} />',
  ].join('\n');
  const v: Virtual = buildVirtualSfc('Comp.weave', src);
  assertVerbatim(v);
  assert.ok(mapOf(v, 'items', 'template'), 'the @for list expression maps');
  assert.ok(mapOf(v, 'title', 'template'), 'the child prop value maps');
});

test('mappings: separate .ts + .html — script maps to .ts, template to .html', () => {
  const ts: string = 'export function setup() { return { name: "a" }; }\n';
  const html: string = '<span>{{ name }}</span>';
  const v: Virtual = buildVirtualSeparate('comp.ts', ts, 'comp.html', html);
  assertVerbatim(v);
  const sm: WeaveMapping | undefined = v.mappings.find((m) => m.source === 'script');
  assert.ok(sm);
  assert.equal(sm!.sourceOffset, 0, 'separate-file script is the whole .ts at offset 0');
  const tm: WeaveMapping | undefined = mapOf(v, 'name', 'template');
  assert.ok(tm, 'template expression maps into the .html');
  assert.equal(html.slice(tm!.sourceOffset, tm!.sourceOffset + tm!.length), 'name');
});
