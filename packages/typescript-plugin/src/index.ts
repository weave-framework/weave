/**
 * Weave TypeScript Service plugin entry. Editors that load tsserver plugins
 * (VS Code via `contributes.typescriptServerPlugins`, WebStorm natively) pick this
 * up and gain the Weave-aware view of component `.ts`/`.weave` files — no TS1192,
 * no spurious "unused import" on template-only imports.
 */
import { createLanguageServicePlugin } from '@volar/typescript/lib/quickstart/createLanguageServicePlugin';
import { createWeaveTsLanguagePlugin } from './language-plugin.js';

export default createLanguageServicePlugin((ts: typeof import('typescript')) => ({
  languagePlugins: [createWeaveTsLanguagePlugin(ts)],
}));
