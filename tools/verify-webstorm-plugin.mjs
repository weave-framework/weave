/**
 * The WebStorm plugin ships a COPY of the language server inside its `.zip`. Nothing used
 * to check that copy against the source it was built from, and it silently went two months
 * stale: the server in `weave-webstorm-0.21.0.zip` predated `auto-expose`, so it typed every
 * template context as `void` and reported "Property 'x' does not exist on type 'void'" on
 * every single binding — 1642 false errors across 39 of 41 files in a real app. The framework
 * was fine, `weave check` was clean, and the editor was a wall of red.
 *
 * This gate makes that state unrepresentable: the `server/server.cjs` inside the shipped
 * `.zip` must be byte-identical to `packages/language-server/dist/server.cjs`. Rebuild the
 * server (`pnpm build:ls`) and the plugin, then re-copy the `.zip` into `plugins/`.
 *
 * Zero-dep by RULE #1: the nested zip (server inside a .jar inside the plugin .zip) is read
 * with a minimal central-directory parser over `node:zlib`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(root, 'plugins/editor/webstorm');
const builtServer = join(root, 'packages/language-server/dist/server.cjs');

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
    if (buf.readUInt32LE(p) !== 0x02014b50) die('corrupt zip central directory');
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

let built;
try {
  built = readFileSync(builtServer);
} catch {
  die(`no built server at ${builtServer} — run \`pnpm build:ls\` first`);
}

if (!shipped.equals(built)) {
  die(
    `the language server inside ${zipName} is NOT the one in packages/language-server/dist.\n` +
      `  shipped: ${shipped.length} bytes\n` +
      `  built  : ${built.length} bytes\n` +
      `A stale bundled server does not fail loudly — it reports WRONG diagnostics on correct code\n` +
      `(0.21.0 predated auto-expose and turned every binding red). Rebuild the plugin and re-copy\n` +
      `its .zip into plugins/editor/webstorm/.`
  );
}

console.log(`✔ ${zipName} bundles the current language server (${built.length} bytes, byte-identical)`);

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
