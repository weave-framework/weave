/**
 * Generates the API-reference data (`docs/src/content/api.gen.ts`) by reading each
 * package's public entry with the TypeScript compiler API and extracting every
 * export: kind, signature, TSDoc summary, parameters (+ @param docs), return type.
 *
 * This keeps the Reference in sync with the code (the "hybrid" plan: generated
 * skeleton + hand-written prose layered on top later). TypeScript is a dev-only
 * tool already in the toolchain — the framework runtime stays zero-dependency.
 *
 * Run by the `docs` / `docs:build` scripts. Mirrors gen-content / routes.gen.
 */

import ts from 'typescript';
import { writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const outFile = join(here, '..', 'src', 'content', 'api.gen.ts');

/** Packages to document, in display order. */
const PKGS = [
  { key: 'runtime', title: '@weave/runtime', entry: 'packages/runtime/src/index.ts' },
  { key: 'router', title: '@weave/router', entry: 'packages/router/src/index.ts' },
  { key: 'store', title: '@weave/store', entry: 'packages/store/src/index.ts' },
  { key: 'forms', title: '@weave/forms', entry: 'packages/forms/src/index.ts' },
  { key: 'i18n', title: '@weave/i18n', entry: 'packages/i18n/src/index.ts' },
  { key: 'data', title: '@weave/data', entry: 'packages/data/src/index.ts' },
];

const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  baseUrl: repo,
  paths: { '@weave/*': ['packages/*/src/index.ts'] },
  noEmit: true,
  skipLibCheck: true,
  strict: true,
};

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

/** The source text of a function/type declaration up to (but excluding) its body. */
function declSignature(decl) {
  const sf = decl.getSourceFile();
  const full = sf.text;
  const start = decl.getStart(sf);
  const end = decl.body ? decl.body.getStart(sf) : decl.getEnd();
  let text = full.slice(start, end);
  text = text.replace(/^export\s+/, '').replace(/^declare\s+/, '').replace(/^default\s+/, '');
  text = text.replace(/\s*\{?\s*$/, '').trim();
  return text;
}

function kindOf(decl) {
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isVariableDeclaration(decl)) return 'const';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isEnumDeclaration(decl)) return 'enum';
  return 'value';
}

/** Map of @param name → description from a symbol's JSDoc tags. */
function paramDocs(sym, checker) {
  const out = {};
  for (const tag of sym.getJsDocTags(checker)) {
    if (tag.name !== 'param' || !tag.text) continue;
    const nameP = tag.text.find((p) => p.kind === 'parameterName');
    const desc = tag.text.filter((p) => p.kind === 'text').map((p) => p.text).join('');
    if (nameP) out[nameP.text] = desc.trim();
  }
  return out;
}

function returnDoc(sym, checker) {
  for (const tag of sym.getJsDocTags(checker)) {
    if (tag.name === 'returns' || tag.name === 'return') {
      return (tag.text ?? []).map((p) => p.text).join('').trim();
    }
  }
  return '';
}

function extract(pkg) {
  const entry = join(repo, pkg.entry);
  const program = ts.createProgram([entry], compilerOptions);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  if (!sf) return [];
  const moduleSym = checker.getSymbolAtLocation(sf);
  if (!moduleSym) return [];

  const exportSyms = checker.getExportsOfModule(moduleSym);
  const symbols = [];

  for (const sym of exportSyms) {
    const name = sym.getName();
    // Re-exported symbols (`export { x } from './y'`) are aliases — resolve to the
    // real declaration so we get the actual kind, signature, and TSDoc.
    let real = sym;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        real = checker.getAliasedSymbol(sym);
      } catch {
        real = sym;
      }
    }
    const decl = real.declarations?.[0];
    if (!decl) continue;
    const kind = kindOf(decl);
    const doc = ts.displayPartsToString(real.getDocumentationComment(checker)).trim();

    let signature = '';
    const params = [];
    let returns = null;

    if (kind === 'function') {
      signature = declSignature(decl);
      const type = checker.getTypeOfSymbolAtLocation(real, decl);
      const callSig = type.getCallSignatures()[0];
      if (callSig) {
        const pdocs = paramDocs(real, checker);
        for (const p of callSig.parameters) {
          const pd = p.valueDeclaration ?? p.declarations?.[0];
          const ptype = pd
            ? checker.typeToString(checker.getTypeOfSymbolAtLocation(p, pd), decl, ts.TypeFormatFlags.NoTruncation)
            : 'unknown';
          params.push({ name: p.getName(), type: ptype, doc: pdocs[p.getName()] ?? '' });
        }
        returns = {
          type: checker.typeToString(callSig.getReturnType(), decl, ts.TypeFormatFlags.NoTruncation),
          doc: returnDoc(real, checker),
        };
      }
    } else if (kind === 'const') {
      const type = checker.getTypeOfSymbolAtLocation(real, decl);
      const tstr = checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation);
      signature = `const ${name}: ${tstr}`;
    } else {
      // type / interface / class / enum — use the source declaration text.
      signature = declSignature(decl);
      if (signature.length > 700) signature = signature.slice(0, 700) + '\n  // …';
    }

    symbols.push({ name, kind, anchor: slugify(name), signature, doc, params, returns });
  }

  // Stable, readable order: functions first, then consts, then types/interfaces.
  const order = { function: 0, const: 1, class: 2, enum: 3, interface: 4, type: 5, value: 6 };
  symbols.sort((a, b) => (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name));
  return symbols;
}

const api = {};
const titles = {};
let total = 0;
for (const pkg of PKGS) {
  try {
    const syms = extract(pkg);
    api[pkg.key] = syms;
    titles[pkg.key] = pkg.title;
    total += syms.length;
    console.log(`gen-api → ${pkg.key}: ${syms.length} exports`);
  } catch (err) {
    console.warn(`gen-api → ${pkg.key} FAILED: ${err.message}`);
    api[pkg.key] = [];
    titles[pkg.key] = pkg.title;
  }
}

const out = `// AUTO-GENERATED by docs/tools/gen-api.mjs — do not edit.
// Extracted from each package's public entry via the TypeScript compiler API.

export interface ApiParam {
  name: string;
  type: string;
  doc: string;
}

export interface ApiSymbol {
  name: string;
  kind: string;
  anchor: string;
  signature: string;
  doc: string;
  params: ApiParam[];
  returns: { type: string; doc: string } | null;
}

export const apiTitles: Record<string, string> = ${JSON.stringify(titles, null, 2)};

export const api: Record<string, ApiSymbol[]> = ${JSON.stringify(api, null, 2)};
`;

await writeFile(outFile, out, 'utf8');
console.log(`gen-api → docs/src/content/api.gen.ts (${total} exports across ${PKGS.length} packages)`);
