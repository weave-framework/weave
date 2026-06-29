/**
 * Generate every favicon size from a single source SVG — no extra deps: the SVG is
 * rasterized with the (already-present) Playwright Chromium at each size with a
 * transparent background, and the multi-size `.ico` is packed by hand (PNG-in-ICO,
 * supported by every browser since Vista).
 *
 * Usage: node tools/gen-favicons.mjs <source.svg> <outDir>
 * Emits: favicon.svg, favicon.ico (16+32), icon-32.png, apple-touch-icon.png (180),
 *        icon-192.png, icon-512.png.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [srcArg, outArg] = process.argv.slice(2);
if (!srcArg || !outArg) {
  console.error('usage: node tools/gen-favicons.mjs <source.svg> <outDir>');
  process.exit(1);
}
const src = resolve(srcArg);
const outDir = resolve(outArg);
await mkdir(outDir, { recursive: true });

const svg = await readFile(src, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

/** Rasterize the SVG to a transparent PNG of `size`×`size`. */
async function rasterize(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       *{margin:0;padding:0}
       html,body{width:${size}px;height:${size}px;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style></head><body>${svg}</body></html>`,
    { waitUntil: 'load' }
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** Pack PNG buffers into a single multi-size .ico (PNG-in-ICO). */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const images = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 ⇒ 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // colors in palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8); // size of image data
    e.writeUInt32LE(offset, 12); // offset of image data
    offset += data.length;
    entries.push(e);
    images.push(data);
  }
  return Buffer.concat([header, ...entries, ...images]);
}

// PNG sizes for the web manifest / Apple / standard favicon.
const png32 = await rasterize(32);
const png180 = await rasterize(180);
const png192 = await rasterize(192);
const png512 = await rasterize(512);
const png16 = await rasterize(16);

await writeFile(join(outDir, 'icon-32.png'), png32);
await writeFile(join(outDir, 'apple-touch-icon.png'), png180);
await writeFile(join(outDir, 'icon-192.png'), png192);
await writeFile(join(outDir, 'icon-512.png'), png512);
await writeFile(join(outDir, 'favicon.ico'), buildIco([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
]));
await copyFile(src, join(outDir, 'favicon.svg'));

await browser.close();
console.log(`favicons → ${outDir}/ (svg, ico[16+32], 32, 180, 192, 512)`);
