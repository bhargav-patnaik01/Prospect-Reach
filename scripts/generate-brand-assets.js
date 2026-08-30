/**
 * Generates the extension's toolbar icon set and side-panel wordmark from
 * the source brand material in assets/brand-source/ — reproducible and
 * scripted, per this sprint's requirement, not a one-off manual export.
 *
 * Source material (see PROJECT_CALIBRATION.md's Sprint 8 notes for how
 * these were found/chosen):
 *  - cittaa-landing-reference.png — a screenshot of Cittaa's own marketing
 *    site. Its palette was sampled directly (see extension/sidepanel.css's
 *    :root custom properties, which document the exact sample coordinates
 *    used) and its pearl/orb graphic is the source for the toolbar icon —
 *    the only mark in the provided material simple enough to read at
 *    16x16; the full cursive wordmark is not.
 *  - cittaa-wordmark-logo.jpg — the Cittaa wordmark, used at the top of
 *    the side panel (not as the toolbar icon — see above).
 *
 * Run with `npm run generate:brand`. Re-running overwrites the committed
 * output files with the same result (byte-for-byte, since the crop
 * coordinates and source files are fixed) — safe to re-run any time.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_DIR = join(ROOT, 'assets', 'brand-source');
const ICONS_DIR = join(ROOT, 'extension', 'icons');
const ASSETS_DIR = join(ROOT, 'extension', 'assets');

// The orb's bounding square within cittaa-landing-reference.png (1893x876),
// found by visual inspection of the rendered screenshot — its edges are a
// soft gradient blur, not a hard boundary an automated brightness scan can
// reliably find, so a circular mask (see below) is applied on top rather
// than relying on a pixel-perfect crop.
const ORB_CROP = { left: 785, top: 295, width: 320, height: 320 };
const ICON_SIZES = [16, 32, 48, 128];

async function generateIcons() {
  await mkdir(ICONS_DIR, { recursive: true });

  const orbSquareBuffer = await sharp(join(SOURCE_DIR, 'cittaa-landing-reference.png'))
    .extract(ORB_CROP)
    .png()
    .toBuffer();
  const { width, height } = await sharp(orbSquareBuffer).metadata();

  // Circular alpha mask, feathered slightly at the edge so the icon reads
  // as a soft pearl rather than a hard-edged coin — matches the source
  // graphic's own soft rendering instead of fighting it.
  const maskSvg = Buffer.from(
    `<svg width="${width}" height="${height}"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%">` +
      `<stop offset="88%" stop-color="white" stop-opacity="1"/>` +
      `<stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
  );
  const maskPng = await sharp(maskSvg).resize(width, height).png().toBuffer();

  const masked = await sharp(orbSquareBuffer)
    .ensureAlpha()
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer();

  for (const size of ICON_SIZES) {
    const outPath = join(ICONS_DIR, `icon${size}.png`);
    await sharp(masked).resize(size, size, { kernel: 'lanczos3' }).png().toFile(outPath);
    console.log(`Wrote ${outPath} (${size}x${size})`);
  }
}

// Brightness above which a wordmark pixel is treated as "background" and
// made transparent, with a soft linear ramp down to WORDMARK_BG_FLOOR so
// the mark's own soft anti-aliased edges don't get a hard cutout line.
const WORDMARK_BG_CEIL = 248;
const WORDMARK_BG_FLOOR = 222;

async function generateWordmark() {
  await mkdir(ASSETS_DIR, { recursive: true });
  const outPath = join(ASSETS_DIR, 'cittaa-wordmark.png');

  // trim() strips the source JPEG's white margin down to just the logo
  // mark. The source is a clean, flat white studio background (verified by
  // inspection), so keying it out by brightness is safe here — this is not
  // a general-purpose background remover, just this specific asset.
  const trimmed = sharp(join(SOURCE_DIR, 'cittaa-wordmark-logo.jpg')).trim();
  const { data, info } = await trimmed.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness >= WORDMARK_BG_CEIL) {
      data[i + 3] = 0;
    } else if (brightness > WORDMARK_BG_FLOOR) {
      const t = (brightness - WORDMARK_BG_FLOOR) / (WORDMARK_BG_CEIL - WORDMARK_BG_FLOOR);
      data[i + 3] = Math.round(data[i + 3] * (1 - t));
    }
  }

  await sharp(data, { raw: info }).png().toFile(outPath);
  console.log(`Wrote ${outPath} (background keyed to transparent)`);
}

async function main() {
  await generateIcons();
  await generateWordmark();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
