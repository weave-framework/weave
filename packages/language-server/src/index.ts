/**
 * @weave/language-server — Volar-based IDE support for `.weave` files.
 *
 * The runnable server is `src/server.ts` (bundled to `dist/server.js` by
 * `build.mjs`). This entry re-exports the language plugin so it can be embedded
 * in other hosts (e.g. a TS-plugin or a test harness).
 */
export { createWeaveLanguagePlugin } from './weave-language.js';
