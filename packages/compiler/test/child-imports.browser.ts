import { test, assert } from '../../../tools/harness.js';
import { compileTemplate, pascalToKebab, childImportCandidates } from '@weave-framework/compiler';

// PascalCase child tag → kebab module basename (the loader's sibling-resolution convention).
test('pascalToKebab maps component tags to module basenames', () => {
  assert.equal(pascalToKebab('Input'), 'input');
  assert.equal(pascalToKebab('Button'), 'button');
  assert.equal(pascalToKebab('SlideToggle'), 'slide-toggle');
  assert.equal(pascalToKebab('RadioGroup'), 'radio-group');
  assert.equal(pascalToKebab('GridList'), 'grid-list');
  assert.equal(pascalToKebab('FormField'), 'form-field');
});

test('childImportCandidates covers dir-per-component and flat layouts, in order', () => {
  assert.deepEqual(childImportCandidates('Input'), ['../input/input', './input', './input/input']);
  assert.deepEqual(childImportCandidates('SlideToggle'), [
    '../slide-toggle/slide-toggle',
    './slide-toggle',
    './slide-toggle/slide-toggle',
  ]);
});

// The whole point: a module-mode compile must REPORT which child tags it references, so the
// loader can wire an import for each (they compile to bare identifiers, not `_c.*` lookups).
test('module mode reports composed child tags and emits bare references', () => {
  const { code, components } = compileTemplate('<div><Input x={{ v() }} /></div>', {
    mode: 'module',
    scope: ['v'],
  });
  assert.deepEqual(components, ['Input']);
  assert.ok(/\bInput\(/.test(code), 'child compiles to a bare `Input(...)` call the module must have in scope');
  assert.ok(!/_c\.Input/.test(code), 'module mode must NOT use the `_c` map');
});

test('components are de-duplicated across repeated tags', () => {
  const { components } = compileTemplate('<div><Input /><Input /><Button /></div>', { mode: 'module' });
  assert.deepEqual(components, ['Input', 'Button']);
});

// Function mode (the library's internal `toComponent`/`_c` tooling) still reports the tags,
// but the code resolves them through the injected `_c` map instead of imports.
test('function mode reports tags but resolves them via the _c map', () => {
  const { code, components } = compileTemplate('<div><Input x={{ v() }} /></div>', {
    mode: 'function',
    scope: ['v'],
  });
  assert.deepEqual(components, ['Input']);
  assert.ok(/_c\.Input\(/.test(code), 'function mode resolves the child through `_c`');
});

test('a template with no composed children reports an empty list', () => {
  const { components } = compileTemplate('<div><span>{{ v() }}</span></div>', { mode: 'module', scope: ['v'] });
  assert.deepEqual(components, []);
});
