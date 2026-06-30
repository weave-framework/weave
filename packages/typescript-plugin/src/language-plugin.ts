/**
 * The string-keyed Volar LanguagePlugin used INSIDE the editor's TypeScript service
 * (a tsserver plugin). Unlike the standalone language server (URI-keyed, for the
 * template-editing experience), this runs in the same process as the built-in TS,
 * so it may safely take over component `.ts` files.
 *
 * For a component `.ts` (one with a sibling `.html` template) it produces the same
 * virtual the `weave check` whole-project pass builds — the verbatim script, the
 * template harness (so imports used only in the template are NOT reported unused),
 * and the synthesized typed default export (so a parent's `import Child from
 * './child'` no longer reports TS1192). Only the script region maps back to the
 * file, so template type errors don't surface on the `.ts` (they surface on the
 * `.html` via the language server); the user's own code keeps its real diagnostics.
 *
 * A `.weave` SFC is handled too, so a `.ts` importing an SFC component also resolves
 * its default export.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { CodeInformation, CodeMapping, LanguagePlugin, VirtualCode } from '@volar/language-core';
// Side-effect import: loads `@volar/typescript`'s augmentation of `LanguagePlugin`
// (the `typescript` field for TS-service integration).
import type {} from '@volar/typescript';
import type * as ts from 'typescript';
import { buildVirtualSfc, buildVirtualSeparate, type Virtual, type WeaveMapping } from '@weave-framework/check/emit';

const HAS_SETUP: RegExp = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;

const ALL_FEATURES: CodeInformation = { verification: true, completion: true, semantic: true, navigation: true };

function snapshotOf(text: string): ts.IScriptSnapshot {
  return { getText: (s, e) => text.slice(s, e), getLength: () => text.length, getChangeRange: () => undefined };
}

const toMapping = (m: WeaveMapping): CodeMapping => ({
  sourceOffsets: [m.sourceOffset],
  generatedOffsets: [m.generatedOffset],
  lengths: [m.length],
  data: ALL_FEATURES,
});

const siblingHtml = (tsPath: string): string => tsPath.replace(/\.ts$/i, '.html');

/** Is this `.ts` a Weave component (sibling `.html` + an exported `setup`)? */
function isComponentTs(fileName: string): boolean {
  if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) return false;
  const html: string = siblingHtml(fileName);
  if (!existsSync(html)) return false;
  try {
    return HAS_SETUP.test(readFileSync(fileName, 'utf8'));
  } catch {
    return false;
  }
}

export function createWeaveTsLanguagePlugin(ts: typeof import('typescript')): LanguagePlugin<string> {
  return {
    getLanguageId(fileName: string): string | undefined {
      if (fileName.endsWith('.weave')) return 'weave';
      if (isComponentTs(fileName)) return 'weave-ts';
      return undefined;
    },
    createVirtualCode(fileName: string, languageId: string, snapshot: ts.IScriptSnapshot): VirtualCode | undefined {
      if (languageId === 'weave') return buildSfc(fileName, snapshot);
      if (languageId === 'weave-ts' || (languageId === 'typescript' && isComponentTs(fileName))) {
        return buildTsComponent(fileName, snapshot);
      }
      return undefined;
    },
    updateVirtualCode(fileName: string, code: VirtualCode, snapshot: ts.IScriptSnapshot): VirtualCode {
      return code.languageId === 'weave' ? buildSfc(fileName, snapshot) : buildTsComponent(fileName, snapshot);
    },
    typescript: {
      extraFileExtensions: [{ extension: 'weave', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }],
      getServiceScript(root: VirtualCode) {
        for (const code of root.embeddedCodes ?? []) {
          if (code.id === 'ts') return { code, extension: '.ts', scriptKind: ts.ScriptKind.TS };
        }
        return undefined;
      },
    },
  };
}

function buildSfc(fileName: string, snapshot: ts.IScriptSnapshot): VirtualCode {
  const source: string = snapshot.getText(0, snapshot.getLength());
  const v: Virtual = buildVirtualSfc(fileName, source);
  const tsCode: VirtualCode = {
    id: 'ts',
    languageId: 'typescript',
    snapshot: snapshotOf(v.text),
    mappings: v.mappings.map(toMapping),
  };
  return { id: 'root', languageId: 'weave', snapshot: snapshotOf(source), mappings: [], embeddedCodes: [tsCode] };
}

function buildTsComponent(fileName: string, snapshot: ts.IScriptSnapshot): VirtualCode {
  const source: string = snapshot.getText(0, snapshot.getLength());
  const htmlPath: string = siblingHtml(fileName);
  const htmlSource: string = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
  const v: Virtual = buildVirtualSeparate(fileName, source, htmlPath, htmlSource);

  // Map ONLY the user's script region to the file (1:1). The appended template
  // harness + synthesized default export stay unmapped: their code is present (so
  // template-used imports are not "unused" and the default export fixes TS1192),
  // but they raise no diagnostics on this `.ts`.
  const mappings: CodeMapping[] = v.mappings.filter((m) => m.source === 'script').map(toMapping);
  const tsCode: VirtualCode = {
    id: 'ts',
    languageId: 'typescript',
    snapshot: snapshotOf(v.text),
    mappings,
  };
  return { id: 'root', languageId: 'weave-ts', snapshot: snapshotOf(source), mappings: [], embeddedCodes: [tsCode] };
}
