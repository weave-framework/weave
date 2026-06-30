/**
 * The Weave language server — a standard Volar/LSP server shared by both editors
 * (VS Code spawns it as a language-client child; the WebStorm plugin registers it
 * through the JetBrains LSP API). All IDE intelligence lives here, once.
 *
 * It runs a real TypeScript project over the `.weave` files' embedded `ts` code
 * (`volar-service-typescript`) plus a CSS service for the `<style>` blocks
 * (`volar-service-css`). The editor passes the path to its own TypeScript via
 * `initializationOptions.typescript.tsdk`, so we never bundle a TypeScript.
 */

import {
  createConnection,
  createServer,
  createTypeScriptProject,
  loadTsdkByPath,
} from '@volar/language-server/node';
import { create as createTypeScriptServices } from 'volar-service-typescript';
import { create as createCssService } from 'volar-service-css';
import { createWeaveLanguagePlugin } from './weave-language.js';

const connection: ReturnType<typeof createConnection> = createConnection();
const server: ReturnType<typeof createServer> = createServer(connection);

connection.listen();

connection.onInitialize((params) => {
  // Some LSP clients (notably LSP4IJ) advertise `workspace/configuration` support but
  // never answer the server's configuration requests. Volar awaits that answer before it
  // computes push diagnostics, so template type errors never surface — while hover and
  // go-to-definition (which don't need configuration) still work. We don't rely on any
  // client settings, so drop the capability: Volar then resolves configuration to defaults
  // immediately and diagnostics flow for every client.
  if (params.capabilities.workspace) {
    params.capabilities.workspace.configuration = false;
  }

  const tsdkPath: string =
    (params.initializationOptions as { typescript?: { tsdk?: string } } | undefined)?.typescript
      ?.tsdk ?? 'typescript/lib';
  const tsdk: ReturnType<typeof loadTsdkByPath> = loadTsdkByPath(tsdkPath, params.locale);

  return server.initialize(
    params,
    createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
      languagePlugins: [createWeaveLanguagePlugin(tsdk.typescript)],
    })),
    [...createTypeScriptServices(tsdk.typescript), createCssService()]
  );
});

connection.onInitialized(() => {
  server.initialized();
});

connection.onShutdown(() => {
  server.shutdown();
});
