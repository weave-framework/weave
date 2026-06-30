import { test, assert } from '../../../tools/harness.js';
import { fileToRoutes, emitRoutesModule } from '@weave-framework/router';
import type { FileRoute } from '@weave-framework/router';

/* ──────────── fileToRoutes: conventions ──────────── */

test('flat files map to routes (index → "", name → path)', () => {
  const r: FileRoute[] = fileToRoutes(['index.weave', 'about.weave']);
  assert.deepEqual(r, [
    { path: '', file: 'index.weave' },
    { path: 'about', file: 'about.weave' },
  ]);
});

test('[id] → :param and [...rest] → * (catch-all)', () => {
  const r: FileRoute[] = fileToRoutes(['[id].weave', '[...all].weave', 'index.weave']);
  const byPath: Record<string, string | undefined> = Object.fromEntries(r.map((x) => [x.path, x.file]));
  assert.equal(byPath[':id'], '[id].weave');
  assert.equal(byPath['*'], '[...all].weave');
  assert.equal(byPath[''], 'index.weave');
  // ordering: static, then dynamic, then catch-all
  assert.deepEqual(r.map((x) => x.path), ['', ':id', '*']);
});

test('a folder without a layout is flattened with a path prefix', () => {
  const r: FileRoute[] = fileToRoutes(['users/index.weave', 'users/[id].weave']);
  assert.deepEqual(r, [
    { path: 'users', file: 'users/index.weave' },
    { path: 'users/:id', file: 'users/[id].weave' },
  ]);
});

test('a folder with a _layout becomes a nested route with children', () => {
  const r: FileRoute[] = fileToRoutes(['users/_layout.weave', 'users/index.weave', 'users/[id].weave']);
  assert.equal(r.length, 1);
  assert.equal(r[0].path, 'users');
  assert.equal(r[0].file, 'users/_layout.weave');
  assert.deepEqual(r[0].children, [
    { path: '', file: 'users/index.weave' },
    { path: ':id', file: 'users/[id].weave' },
  ]);
});

/* ──────────── emitRoutesModule ──────────── */

test('emits an eager module with imports + component refs', () => {
  const mod: string = emitRoutesModule([
    { path: '', file: 'index.weave' },
    { path: 'about', file: 'about.weave' },
  ]);
  assert.ok(mod.includes('import Page0 from "./index.weave";'), mod);
  assert.ok(mod.includes('import Page1 from "./about.weave";'), mod);
  assert.ok(mod.includes('path: ""'), mod);
  assert.ok(mod.includes('component: Page0'), mod);
  assert.ok(mod.includes('export const routes ='), mod);
});

test('emits a lazy module that code-splits each page', () => {
  const mod: string = emitRoutesModule([{ path: '', file: 'index.weave' }], { lazy: true });
  assert.ok(mod.includes('import { lazy } from "@weave-framework/runtime/dom";'), mod);
  assert.ok(mod.includes('lazy(() => import("./index.weave"))'), mod);
});

test('a TS/JS page extension is stripped so the import resolves under tsc + esbuild', () => {
  const lazyMod: string = emitRoutesModule([{ path: 'task/:id', file: 'task/[id].ts' }], { lazy: true });
  assert.ok(lazyMod.includes('import("./task/[id]")'), lazyMod);
  const eager: string = emitRoutesModule([{ path: '', file: 'index.tsx' }]);
  assert.ok(eager.includes('import Page0 from "./index";'), eager);
});

test('nested children serialize recursively', () => {
  const mod: string = emitRoutesModule([
    { path: 'users', file: 'users/_layout.weave', children: [{ path: '', file: 'users/index.weave' }] },
  ]);
  assert.ok(mod.includes('children: ['), mod);
  assert.ok(mod.includes('"./users/_layout.weave"'), mod);
  assert.ok(mod.includes('"./users/index.weave"'), mod);
});
