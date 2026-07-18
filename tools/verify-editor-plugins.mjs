/**
 * The WebStorm plugin ships a COPY of the language server inside its `.zip`. Nothing used
 * to check that copy against the source it was built from, and it silently went two months
 * stale: the server in `weave-webstorm-0.21.0.zip` predated `auto-expose`, so it typed every
 * template context as `void` and reported "Property 'x' does not exist on type 'void'" on
 * every single binding — 1642 false errors across 39 of 41 files in a real app. The framework
 * was fine, `weave check` was clean, and the editor was a wall of red.
 *
 * This gate makes that state unrepresentable: the server inside the shipped `.zip`, and the
 * language-server source it was built from, are both pinned by hash in `bundled-server.json`.
 * Change the server and the gate fails until the plugin is rebuilt, re-shipped, and re-recorded
 * with `--update`. (See the note above the check for why this is not a byte comparison.)
 *
 * Zero-dep by RULE #1: the nested zip (server inside a .jar inside the plugin .zip) is read
 * with a minimal central-directory parser over `node:zlib`.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(root, 'plugins/editor/webstorm');

const die = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

/** Read every entry matching a predicate out of a zip buffer, as `[name, contents]` pairs. */
function readZipEntries(buf, match) {
  const out = [];
  eachZipEntry(buf, (name, read) => {
    if (match(name)) out.push([name, read()]);
  });
  return out;
}

/** Walk a zip's central directory, handing each entry's name and a lazy reader to `visit`. */
function eachZipEntry(buf, visit) {
  // End of Central Directory: signature 0x06054b50, scanned from the tail (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) die('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of first central-directory entry

  for (let i = 0; i < count; i++) {
    // Not necessarily corruption. An older `.vsix` here had a stale central-directory offset —
    // rewritten in place by a packaging step that never fixed it. Lenient readers cope by
    // scanning local headers; this one trusts the directory, so report what actually happened
    // instead of calling a file corrupt.
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      die(
        `the archive's central directory does not start where its own footer says (offset ${p}).\n` +
          `  Likely rewritten in place by a packaging step without fixing offsets — rebuild it.`
      );
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    const read = () => {
      // Local file header: name/extra lengths differ from the central copy — read them here.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataAt = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataAt, dataAt + compSize);
      if (method === 0) return data; // stored
      if (method === 8) return inflateRawSync(data); // deflate
      return die(`unsupported zip compression method ${method} for "${name}"`);
    };
    const stop = visit(name, read);
    if (stop === true) return;
    p += 46 + nameLen + extraLen + commentLen;
  }
}

/** Read one entry out of a zip buffer by exact name, or by a predicate. */
function readZipEntry(buf, match) {
  let found;
  eachZipEntry(buf, (name, read) => {
    if (match(name)) {
      found = read();
      return true;
    }
  });
  return found;
}

const zips = readdirSync(pluginDir).filter((f) => /^weave-webstorm-.*\.zip$/.test(f));
if (zips.length === 0) die(`no weave-webstorm-*.zip in ${pluginDir}`);
if (zips.length > 1) {
  die(`${zips.length} plugin zips in ${pluginDir} (${zips.join(', ')}) — ship exactly one, delete the rest`);
}
const zipName = zips[0];

const pluginZip = readFileSync(join(pluginDir, zipName));
const jar = readZipEntry(pluginZip, (n) => /^weave-webstorm\/lib\/weave-webstorm-[^/]*\.jar$/.test(n));
if (!jar) die(`${zipName} contains no weave-webstorm-*.jar`);

const shipped = readZipEntry(jar, (n) => n === 'server/server.cjs');
if (!shipped) die(`${zipName} bundles no server/server.cjs — the plugin would start no language server`);

/* The invariant is "the shipped server was built from the CURRENT source", and the first cut of
 * this gate tried to prove it by comparing the zip's bytes to a fresh local build. That was wrong:
 * esbuild's output is not byte-reproducible across platforms (the Linux runner produced a bundle
 * 76 bytes larger than the Windows one from the same commit), so the gate went red on a correct
 * tree the first time CI ran it. A gate that cries wolf is worse than none — it teaches everyone
 * to scroll past red.
 *
 * So the check is pinned to two platform-stable hashes recorded in a committed manifest:
 *   serverSha  — of the bytes actually inside the shipped .zip, so the artifact cannot be swapped
 *                for one nobody reviewed.
 *   sourceSha  — of the language-server sources with line endings normalised, so editing the
 *                server without rebuilding and re-shipping the plugin fails.
 * Neither depends on which machine ran esbuild.
 *
 * `sourceSha` also folds in the lockfile's RESOLVED versions for the language server's own
 * dependencies, because "built from the current source" has to mean the current Volar too — the
 * bundle is mostly Volar, and bumping it changes what the shipped server does while every source
 * file stays byte-identical. Taking the resolved versions (not the `^2.4.11` specifiers) means a
 * caret bump moves the hash; scoping it to this package's importer block means an unrelated bump
 * elsewhere in the monorepo does NOT force a plugin rebuild.
 *
 * Residual gap, stated rather than papered over: a bump that only moves a TRANSITIVE dependency
 * still slips through. Closing that would mean hashing the whole lockfile, which is the cry-wolf
 * failure this gate already made once, in a milder costume. */
const manifestPath = join(pluginDir, 'bundled-server.json');
const lsSrc = join(root, 'packages/language-server/src');

/** Hash a directory's files with line endings normalised, so Windows CRLF and Linux LF agree. */
function hashSources(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        h.update(e.name);
        h.update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
      }
    }
  };
  walk(dir);
  h.update(lockfileDeps());
  return h.digest('hex');
}

/**
 * The lockfile's `importers` block for the language server: its direct dependencies with the
 * RESOLVED versions, so a caret bump (`^2.4.11` → 2.4.29) moves the hash even though every
 * source file is byte-identical. Shipping a months-old Volar is exactly the kind of stale this
 * gate exists to catch.
 */
function lockfileDeps() {
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split(/\r?\n/);
  const start = lock.findIndex((l) => l === '  packages/language-server:');
  if (start === -1) die('pnpm-lock.yaml has no importer block for packages/language-server');
  // Runs until the next importer at the same indent (two spaces, then a path).
  let end = lock.length;
  for (let i = start + 1; i < lock.length; i++) {
    if (/^ {2}\S/.test(lock[i])) {
      end = i;
      break;
    }
  }
  return lock.slice(start, end).join('\n');
}

const shippedSha = createHash('sha256').update(shipped).digest('hex');
const sourceSha = hashSources(lsSrc);

if (process.argv.includes('--update') || !existsSync(manifestPath)) {
  writeFileSync(
    manifestPath,
    JSON.stringify({ zip: zipName, serverSha: shippedSha, sourceSha }, null, 2) + '\n'
  );
  console.log(`✔ recorded ${zipName} (server ${shippedSha.slice(0, 12)}…, source ${sourceSha.slice(0, 12)}…)`);
} else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (m.zip !== zipName) {
    die(`the shipped plugin is ${zipName} but the manifest records ${m.zip} — rebuild and re-record.`);
  }
  if (m.serverSha !== shippedSha) {
    die(
      `the server inside ${zipName} is not the one recorded in bundled-server.json.\n` +
        `  recorded: ${m.serverSha}\n  actual:   ${shippedSha}\n` +
        `The .zip was replaced without re-recording. If that was intentional, re-run with --update.`
    );
  }
  if (m.sourceSha !== sourceSha) {
    die(
      `the language server changed since ${zipName} was built — either its sources or the\n` +
        `  resolved versions of its dependencies (a Volar bump moves this too).\n` +
        `  recorded: ${m.sourceSha}\n  actual:   ${sourceSha}\n` +
        `A stale bundled server does not fail loudly — it reports WRONG diagnostics on correct code\n` +
        `(0.21.0 predated auto-expose and turned every binding red). Rebuild the plugin, copy its\n` +
        `.zip into plugins/editor/webstorm/, and re-run this with --update.`
    );
  }
  console.log(`✔ ${zipName} bundles a server built from the current language-server source`);
}

/* ─────────────────────────── semantic colours ───────────────────────────
 * A `TextAttributesKey` fallback is NOT a promise of a colour. `DEFAULT_FUNCTION_CALL` carries no
 * foreground in Default, IntelliJ Light OR Darcula, so `WEAVE_BINDING_CALL` — which fell back to it
 * — rendered as plain black text: in a template of twelve calls, exactly one identifier was
 * coloured, and the highlighting looked simply broken.
 *
 * Nothing catches that at build time (it renders fine, just colourless), so this asserts every
 * WEAVE_* key the plugin declares is accounted for: either the plugin states its colour outright in
 * BOTH bundled scheme files, or it is listed below with the measurement showing its fallback really
 * is coloured in the schemes the IDE ships. A new key is a hard failure until one of the two holds.
 */

/** Fallback-reliant keys, each with the FOREGROUND measured in the IDE's own scheme XMLs. */
const VERIFIED_FALLBACKS = {
  // measured in DefaultColorSchemesManager.xml + themes/Light.xml (WebStorm 261 EAP)
  WEAVE_COMPONENT_TAG: 'DEFAULT_METADATA — light #808000 / IntelliJ Light #9E880D / Darcula #BBB529',
  WEAVE_BINDING_BRACES: 'DEFAULT_KEYWORD — light #000080 / IntelliJ Light #0033B3 / Darcula #CC7832',
  WEAVE_DIRECTIVE: 'DEFAULT_KEYWORD — light #000080 / IntelliJ Light #0033B3 / Darcula #CC7832',
  WEAVE_BINDING_IDENT: 'DEFAULT_INSTANCE_FIELD — light #660E7A / IntelliJ Light #871094 / Darcula #9876AA',
  WEAVE_ATTRIBUTE: 'XmlHighlighterColors.HTML_ATTRIBUTE_NAME — set by the bundled XML schemes',
};

// The scheme files are referenced by PATH from plugin.xml. A wrong path is not a build error — the
// IDE just logs and moves on, leaving the colours unset — so resolve every reference for real.
const pluginXml = readZipEntry(jar, (n) => n === 'META-INF/plugin.xml');
if (!pluginXml) die(`${zipName} contains no META-INF/plugin.xml`);
const referenced = [...pluginXml.toString('utf8').matchAll(/<additionalTextAttributes\s+scheme="([^"]+)"\s+file="([^"]+)"/g)];
if (referenced.length === 0) {
  die('plugin.xml declares no <additionalTextAttributes> — the explicit colour defaults are not wired up');
}
for (const [, scheme, file] of referenced) {
  if (!readZipEntry(jar, (n) => n === file)) {
    die(`plugin.xml points <additionalTextAttributes scheme="${scheme}"> at "${file}", which is not in the jar`);
  }
}
const schemeFiles = referenced.map(([, , file]) => file);
const schemes = new Map();
for (const f of schemeFiles) {
  const xml = readZipEntry(jar, (n) => n === f);
  if (!xml) die(`${zipName} bundles no ${f} — the explicit colour defaults are missing`);
  const declared = new Set([...xml.toString('utf8').matchAll(/<option name="(WEAVE_[A-Z_]+)"/g)].map((m) => m[1]));
  schemes.set(f, declared);
}

// The key names live in the compiled Kotlin as constant-pool strings — read them from the shipped
// jar rather than the source tree, so this checks the artifact the user installs.
const keys = new Set();
for (const [, cls] of readZipEntries(jar, (n) => n.startsWith('dev/weave/') && n.endsWith('.class'))) {
  for (const m of cls.toString('latin1').matchAll(/WEAVE_[A-Z_]+/g)) keys.add(m[0]);
}
if (keys.size === 0) die(`found no WEAVE_* colour keys in ${zipName} — did the class layout change?`);

const uncovered = [...keys].filter(
  (k) => !VERIFIED_FALLBACKS[k] && !schemeFiles.every((f) => schemes.get(f).has(k))
);
if (uncovered.length) {
  die(
    `these colour keys have neither an explicit default nor a verified fallback: ${uncovered.join(', ')}\n` +
      `Add each to BOTH ${schemeFiles.join(' and ')}, or — after checking the IDE's own scheme XMLs\n` +
      `actually give its fallback a FOREGROUND — record the measurement in VERIFIED_FALLBACKS.\n` +
      `An unverified key does not fail loudly: it renders as plain text and reads as broken highlighting.`
  );
}

const explicit = [...keys].filter((k) => schemeFiles.every((f) => schemes.get(f).has(k)));
console.log(
  `✔ ${keys.size} semantic colour keys covered ` +
    `(${explicit.length} stated explicitly in both schemes, ${keys.size - explicit.length} on verified fallbacks)`
);

/* ─────────────────────────── the VS Code extension ───────────────────────────
 * The same trap, one editor over. The shipped `weave-language-0.5.0.vsix` bundled a server
 * built on 30 June — older still than the WebStorm one — so a VS Code user got the identical
 * wall of red on correct code, and its staged tsserver plugin was still under the pre-rename
 * `@weave/` scope, which VS Code's TypeScript extension resolves by name and therefore could
 * not load at all.
 *
 * Same invariant, same two hashes. The `.vsix` is a plain zip (no nested jar).
 */
const vscodeDir = join(root, 'plugins/editor/vscode');
const vsixes = readdirSync(vscodeDir).filter((f) => f.endsWith('.vsix'));
if (vsixes.length === 0) die(`no .vsix in ${vscodeDir}`);
if (vsixes.length > 1) {
  die(`${vsixes.length} .vsix files in ${vscodeDir} (${vsixes.join(', ')}) — ship exactly one`);
}
const vsixName = vsixes[0];
const vsix = readFileSync(join(vscodeDir, vsixName));

const vsixServer = readZipEntry(vsix, (n) => n === 'extension/dist/server.cjs');
if (!vsixServer) die(`${vsixName} bundles no extension/dist/server.cjs — it would start no language server`);

// The tsserver plugin is resolved BY NAME from the extension's own node_modules, so a stale
// scope is not a warning — the plugin silently never loads and `.ts` files keep their TS1192.
const stagedPlugin = readZipEntry(
  vsix,
  (n) => n === 'extension/node_modules/@weave-framework/typescript-plugin/index.cjs'
);
if (!stagedPlugin) {
  die(
    `${vsixName} does not carry extension/node_modules/@weave-framework/typescript-plugin/index.cjs.\n` +
      `VS Code resolves that contribution by name; without it the .ts side silently gets no plugin.`
  );
}

const vscodeManifestPath = join(vscodeDir, 'bundled-server.json');
const vsixServerSha = createHash('sha256').update(vsixServer).digest('hex');

if (process.argv.includes('--update') || !existsSync(vscodeManifestPath)) {
  writeFileSync(
    vscodeManifestPath,
    JSON.stringify({ vsix: vsixName, serverSha: vsixServerSha, sourceSha }, null, 2) + '\n'
  );
  console.log(`✔ recorded ${vsixName} (server ${vsixServerSha.slice(0, 12)}…, source ${sourceSha.slice(0, 12)}…)`);
} else {
  const m = JSON.parse(readFileSync(vscodeManifestPath, 'utf8'));
  if (m.vsix !== vsixName) die(`the shipped extension is ${vsixName} but the manifest records ${m.vsix}.`);
  if (m.serverSha !== vsixServerSha) {
    die(
      `the server inside ${vsixName} is not the one recorded.\n` +
        `  recorded: ${m.serverSha}\n  actual:   ${vsixServerSha}\n` +
        `The .vsix was replaced without re-recording. If intentional, re-run with --update.`
    );
  }
  if (m.sourceSha !== sourceSha) {
    die(
      `the language server changed since ${vsixName} was built — either its sources or the\n` +
        `  resolved versions of its dependencies (a Volar bump moves this too).\n` +
        `  recorded: ${m.sourceSha}\n  actual:   ${sourceSha}\n` +
        `Rebuild the extension (editor/vscode: build.mjs -> vsce package -> inject-plugin.mjs),\n` +
        `copy the .vsix into plugins/editor/vscode/, and re-run with --update.`
    );
  }
  console.log(`✔ ${vsixName} bundles a server built from the current language-server source`);
}

/* ─────────────────── the docs must name the artifact that exists ───────────────────
 * The install instructions carry a literal filename, and on 2026-07-18 the live site was still
 * telling readers to download `weave-language-0.5.0.vsix` and `weave-webstorm-0.21.0.zip` — the
 * exact two builds whose stale servers had just been replaced for reddening every binding in a
 * correct file. Fixing the artifact and leaving the docs pointing at the old one sends every new
 * reader straight back into the bug.
 *
 * A version written in prose drifts by default. This makes it drift loudly instead.
 */
const docSources = [
  'docs/src/content/learn/tooling.md',
  'plugins/editor/vscode/README.md',
  'plugins/editor/webstorm/README.md',
  'README.md',
];
const named = new Map(); // filename -> [where]
for (const rel of docSources) {
  const p = join(root, rel);
  if (!existsSync(p)) continue;
  for (const m of readFileSync(p, 'utf8').matchAll(/weave-(?:webstorm-[\d.]+\.zip|language-[\d.]+\.vsix)/g)) {
    if (!named.has(m[0])) named.set(m[0], []);
    if (!named.get(m[0]).includes(rel)) named.get(m[0]).push(rel);
  }
}
const wrong = [...named].filter(([f]) => f !== zipName && f !== vsixName);
if (wrong.length) {
  die(
    `the docs name editor plugin builds that are not the ones shipped:\n` +
      wrong.map(([f, where]) => `    ${f}  (in ${where.join(', ')})`).join('\n') +
      `\n  Shipped: ${zipName} and ${vsixName}.\n` +
      `  A reader following those instructions installs the old build — which is how a stale server\n` +
      `  reaches someone weeks after it was fixed.`
  );
}
console.log(`✔ install instructions name the shipped builds (${named.size} reference${named.size === 1 ? '' : 's'})`);
