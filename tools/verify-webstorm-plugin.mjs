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

/** Read one entry out of a zip buffer by exact name, or by a predicate. */
function readZipEntry(buf, match) {
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

    if (match(name)) {
      // Local file header: name/extra lengths differ from the central copy — read them here.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataAt = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataAt, dataAt + compSize);
      if (method === 0) return data; // stored
      if (method === 8) return inflateRawSync(data); // deflate
      die(`unsupported zip compression method ${method} for "${name}"`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
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
