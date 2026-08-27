/**
 * Populates extension/ with build artifacts copied from single sources of
 * truth elsewhere in the repo, so nothing under extension/lib or
 * extension/templates is hand-maintained in two places:
 *
 *  - extension/lib/validate.js, extension/lib/sheet-rows.js,
 *    extension/lib/mailsuite-config.js                        <- src/*.js
 *    (byte-for-byte copies; these files have zero Node-specific imports, so
 *    they run unmodified in the extension's side panel/service worker
 *    contexts — mailsuite-config.js is imported directly by background.js)
 *  - extension/templates/blank/prospects.xlsx                <- templates/blank/*
 *  - extension/templates/categories/*.json (+ a generated index.json)
 *                                                              <- templates/categories/*
 *    (index.json exists because a packed/unpacked extension has no
 *    fs.readdir()-equivalent to discover bundled files at runtime — see
 *    src/excel.js's loadCategories() vs. extension/lib/browser-excel.js's
 *    loadCategoriesBrowser(), which is handed this generated file list.)
 *  - extension/vendor/exceljs.min.js                          <- node_modules/exceljs
 *    (the browser UMD build of the same exceljs version the Node code uses —
 *    same documented Workbook/Worksheet API, see PROJECT_CALIBRATION.md's
 *    Sprint 5 notes on why this is a legitimate, not merely convenient,
 *    choice.)
 *
 * Run with `npm run build:extension` after changing any of the above. The
 * extension/ directory is still committed to the repo (not gitignored) —
 * end users load it via Chrome's "Load unpacked" and never run this script
 * or any other npm command.
 */
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function copyLibModules() {
  const destDir = join(ROOT, 'extension', 'lib');
  await mkdir(destDir, { recursive: true });
  for (const file of ['validate.js', 'sheet-rows.js', 'mailsuite-config.js']) {
    await copyFile(join(ROOT, 'src', file), join(destDir, file));
    console.log(`Copied src/${file} -> extension/lib/${file}`);
  }
}

async function copyBlankTemplate() {
  const destDir = join(ROOT, 'extension', 'templates', 'blank');
  await mkdir(destDir, { recursive: true });
  await copyFile(
    join(ROOT, 'templates', 'blank', 'prospects.xlsx'),
    join(destDir, 'prospects.xlsx'),
  );
  console.log('Copied templates/blank/prospects.xlsx -> extension/templates/blank/prospects.xlsx');
}

async function copyCategoryTemplates() {
  const srcDir = join(ROOT, 'templates', 'categories');
  const destDir = join(ROOT, 'extension', 'templates', 'categories');
  await mkdir(destDir, { recursive: true });

  const files = (await readdir(srcDir)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    await copyFile(join(srcDir, file), join(destDir, file));
  }
  await writeFile(join(destDir, 'index.json'), JSON.stringify(files, null, 2));
  console.log(`Copied ${files.length} category file(s) + generated index.json`);
}

async function copyExceljsBrowserBuild() {
  const destDir = join(ROOT, 'extension', 'vendor');
  await mkdir(destDir, { recursive: true });
  const src = join(ROOT, 'node_modules', 'exceljs', 'dist', 'exceljs.min.js');
  await readFile(src); // fail fast with a clear error if exceljs isn't installed
  await copyFile(src, join(destDir, 'exceljs.min.js'));
  console.log('Copied node_modules/exceljs/dist/exceljs.min.js -> extension/vendor/exceljs.min.js');
}

async function main() {
  await copyLibModules();
  await copyBlankTemplate();
  await copyCategoryTemplates();
  await copyExceljsBrowserBuild();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
