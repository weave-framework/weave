/**
 * Volar language plugin for `.weave` SFCs.
 *
 * Each `.weave` file becomes a root virtual code with two embedded codes:
 *  - **`ts`** — the same type-check harness `weave check` generates (script verbatim
 *    + `__weave__()` placing every template expression against `ReturnType<typeof
 *    setup>`), carrying char-precise mappings back to the `.weave` source. This is
 *    what gives the editor real template type errors, hover, go-to-definition and
 *    rename — and a synthesized typed default export, so a parent's
 *    `import Child from './child'` no longer reports TS1192.
 *  - **`css`** — the `<style>` body, handed to the CSS service.
 *
 * Crucially, the `.weave` root itself is *not* a TypeScript or HTML document, so the
 * editor stops running HTML validation on it ("Unknown html tag", "Attribute … is
 * not allowed", "Closing tag matches nothing", …). Only the regions we map carry
 * language features.
 *
 * One emitter (`@weave/check`) feeds both this server and `weave check`, so the
 * editor and the CLI can never disagree about a template's types.
 */

import {
  forEachEmbeddedCode,
  type CodeInformation,
  type CodeMapping,
  type LanguagePlugin,
  type VirtualCode,
} from '@volar/language-core';
import type * as ts from 'typescript';
import type { URI } from 'vscode-uri';
import { buildVirtualSfc, type Virtual } from '@weave/check/emit';
import { parseSfcLoc, type ComponentSourceLoc } from '@weave/compiler';

/** Every mapped region gets the full set of language features. */
const ALL_FEATURES: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
};

function snapshotOf(text: string): ts.IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  };
}

const isWeave = (uri: URI): boolean => uri.path.endsWith('.weave');

/** Build the Volar language plugin. `ts` is the editor-provided TypeScript module. */
export function createWeaveLanguagePlugin(ts: typeof import('typescript')): LanguagePlugin<URI> {
  return {
    getLanguageId(uri: URI): string | undefined {
      return isWeave(uri) ? 'weave' : undefined;
    },
    createVirtualCode(uri: URI, languageId: string, snapshot: ts.IScriptSnapshot): VirtualCode | undefined {
      if (languageId !== 'weave') return undefined;
      return buildWeaveRoot(uri, snapshot);
    },
    updateVirtualCode(uri: URI, _code: VirtualCode, snapshot: ts.IScriptSnapshot): VirtualCode {
      return buildWeaveRoot(uri, snapshot);
    },
    typescript: {
      // Teach the TS project that `.weave` is a real source extension (mixed content,
      // deferred to our embedded `ts` code) so module resolution + imports work.
      extraFileExtensions: [
        { extension: 'weave', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
      ],
      getServiceScript(root: VirtualCode) {
        for (const code of forEachEmbeddedCode(root)) {
          if (code.id === 'ts') {
            return { code, extension: '.ts', scriptKind: ts.ScriptKind.TS };
          }
        }
        return undefined;
      },
    },
  };
}

function buildWeaveRoot(uri: URI, snapshot: ts.IScriptSnapshot): VirtualCode {
  const source: string = snapshot.getText(0, snapshot.getLength());
  const v: Virtual = buildVirtualSfc(uri.fsPath, source);

  // The emitter's char-precise runs become Volar mappings. Both `script` and
  // `template` runs index into the original `.weave` file (offset-faithful), so a
  // single mapping per run suffices.
  const tsMappings: CodeMapping[] = v.mappings.map((m) => ({
    sourceOffsets: [m.sourceOffset],
    generatedOffsets: [m.generatedOffset],
    lengths: [m.length],
    data: ALL_FEATURES,
  }));

  const embeddedCodes: VirtualCode[] = [
    { id: 'ts', languageId: 'typescript', snapshot: snapshotOf(v.text), mappings: tsMappings },
  ];

  const loc: ComponentSourceLoc = parseSfcLoc(source);
  if (loc.styles) {
    embeddedCodes.push({
      id: 'css',
      languageId: 'css',
      snapshot: snapshotOf(loc.styles),
      mappings: [
        {
          sourceOffsets: [loc.styleOffset],
          generatedOffsets: [0],
          lengths: [loc.styles.length],
          data: ALL_FEATURES,
        },
      ],
    });
  }

  return {
    id: 'root',
    languageId: 'weave',
    snapshot: snapshotOf(source),
    mappings: [], // the root carries no features directly; only its embedded codes do
    embeddedCodes,
  };
}
