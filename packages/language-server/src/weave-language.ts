/**
 * Volar language plugin for Weave — both authoring forms:
 *
 *  - **`.weave` SFC** → one root with embedded `ts` (the `weave check` harness +
 *    char-precise mappings) and `css` (the `<style>` body).
 *  - **`.html` template + sibling `.ts`** (the demo's form) → the `.html` is claimed
 *    as `weave-html` (so the editor stops HTML-validating it — no "Unknown html
 *    tag" / "Closing tag matches nothing"), and its embedded `ts` *inlines* the
 *    sibling component so capitalized tags (`<RouterView>`) resolve to that file's
 *    imports. Template expressions map to the `.html`; the inlined script region
 *    maps (via `associatedScriptMappings`) back to the `.ts`, so go-to-definition
 *    on a template variable lands in the component file.
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
import { URI } from 'vscode-uri';
import { existsSync, readFileSync } from 'node:fs';
import {
  buildVirtualSfc,
  buildVirtualSeparate,
  type Virtual,
  type WeaveMapping,
} from '@weave/check/emit';
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

const toMapping = (m: WeaveMapping): CodeMapping => ({
  sourceOffsets: [m.sourceOffset],
  generatedOffsets: [m.generatedOffset],
  lengths: [m.length],
  data: ALL_FEATURES,
});

const siblingTs = (htmlFsPath: string): string => htmlFsPath.replace(/\.html$/i, '.ts');

/** Build the Volar language plugin. `ts` is the editor-provided TypeScript module. */
export function createWeaveLanguagePlugin(ts: typeof import('typescript')): LanguagePlugin<URI> {
  return {
    getLanguageId(uri: URI): string | undefined {
      if (uri.path.endsWith('.weave')) return 'weave';
      // Only claim a `.html` that is a Weave template (has a sibling component `.ts`),
      // so ordinary web pages keep their normal HTML support.
      if (uri.path.endsWith('.html') && existsSync(siblingTs(uri.fsPath))) return 'weave-html';
      return undefined;
    },
    createVirtualCode(uri: URI, languageId: string, snapshot: ts.IScriptSnapshot): VirtualCode | undefined {
      if (languageId === 'weave') return buildSfcRoot(uri, snapshot);
      if (languageId === 'weave-html') return buildTemplateRoot(uri, snapshot);
      return undefined;
    },
    updateVirtualCode(uri: URI, code: VirtualCode, snapshot: ts.IScriptSnapshot): VirtualCode {
      return code.languageId === 'weave-html' ? buildTemplateRoot(uri, snapshot) : buildSfcRoot(uri, snapshot);
    },
    typescript: {
      // Teach the TS project that `.weave`/`.html` are real source extensions (mixed
      // content, deferred to our embedded `ts` code) so module resolution + imports work.
      extraFileExtensions: [
        { extension: 'weave', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
        { extension: 'html', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
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

/** A `.weave` SFC: embedded `ts` + `css`, both mapping into the single file. */
function buildSfcRoot(uri: URI, snapshot: ts.IScriptSnapshot): VirtualCode {
  const source: string = snapshot.getText(0, snapshot.getLength());
  const v: Virtual = buildVirtualSfc(uri.fsPath, source);

  // Both `script` and `template` runs index into the same `.weave` file.
  const tsMappings: CodeMapping[] = v.mappings.map(toMapping);
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
    mappings: [],
    embeddedCodes,
  };
}

/** A `.html` template paired with a sibling `.ts`: inline the component, split the maps. */
function buildTemplateRoot(uri: URI, snapshot: ts.IScriptSnapshot): VirtualCode {
  const htmlSource: string = snapshot.getText(0, snapshot.getLength());
  const htmlPath: string = uri.fsPath;
  const tsPath: string = siblingTs(htmlPath);

  // No sibling component: still claim the file (HTML validation stays off) but offer
  // no TS — nothing to type-check against.
  if (!existsSync(tsPath)) {
    return { id: 'root', languageId: 'weave-html', snapshot: snapshotOf(htmlSource), mappings: [], embeddedCodes: [] };
  }

  const tsSource: string = readFileSync(tsPath, 'utf8');
  const v: Virtual = buildVirtualSeparate(tsPath, tsSource, htmlPath, htmlSource);

  // Template runs map to THIS `.html` (the root); the inlined script region maps back
  // to the sibling `.ts` as an associated script (so definitions land in the `.ts`).
  const rootMappings: CodeMapping[] = [];
  const scriptMappings: CodeMapping[] = [];
  for (const m of v.mappings) {
    (m.source === 'template' ? rootMappings : scriptMappings).push(toMapping(m));
  }

  const tsCode: VirtualCode = {
    id: 'ts',
    languageId: 'typescript',
    snapshot: snapshotOf(v.text),
    mappings: rootMappings,
    associatedScriptMappings: new Map<unknown, CodeMapping[]>([[URI.file(tsPath), scriptMappings]]),
  };

  return {
    id: 'root',
    languageId: 'weave-html',
    snapshot: snapshotOf(htmlSource),
    mappings: [],
    embeddedCodes: [tsCode],
  };
}
