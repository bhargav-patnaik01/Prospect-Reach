/**
 * Proves src/mailsuite-config.js — copied verbatim into
 * extension/lib/mailsuite-config.js — loads correctly against the real
 * (fixture-valued) templates/categories/*.json files, and rejects malformed
 * config loudly rather than silently. Real Mailsuite template names/
 * placeholder strings aren't available yet (see PROJECT_CALIBRATION.md's
 * Sprint 6 notes) — this only proves the loading/validation code is
 * correct, not that the fixture values are real.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildMailsuiteConfigMap, parseMailsuiteConfig } from '../src/mailsuite-config.js';

const CATEGORIES_DIR = join(import.meta.dirname, '..', 'templates', 'categories');

async function readCategoryDefinitions() {
  const files = (await readdir(CATEGORIES_DIR)).filter((f) => f.endsWith('.json'));
  return Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(CATEGORIES_DIR, file), 'utf8'))),
  );
}

test('buildMailsuiteConfigMap: loads every real category file into a lower-cased config map', async () => {
  const definitions = await readCategoryDefinitions();
  const map = buildMailsuiteConfigMap(definitions);

  assert.equal(map.size, 3, 'cold-outreach, newsletter, partnership');
  assert.ok(map.has('cold outreach'));
  assert.ok(map.has('newsletter'));
  assert.ok(map.has('partnership'));

  const partnership = map.get('partnership');
  assert.equal(partnership.categoryName, 'Partnership');
  assert.match(partnership.mailsuiteTemplateName, /^FIXTURE/, 'fixture values must be obviously fake, not real-looking');
  assert.equal(partnership.placeholders.name, '{{FirstName}}');
  assert.equal(partnership.placeholders.company, '{{Company}}');
});

test('parseMailsuiteConfig: throws loudly on a missing mailsuiteTemplateName', () => {
  assert.throws(
    () => parseMailsuiteConfig({ name: 'Broken', placeholders: { name: 'x', company: 'y' } }),
    /missing "mailsuiteTemplateName"/,
  );
});

test('parseMailsuiteConfig: throws loudly on missing placeholders', () => {
  assert.throws(
    () => parseMailsuiteConfig({ name: 'Broken', mailsuiteTemplateName: 'Some Template' }),
    /missing "placeholders/,
  );
});

test('parseMailsuiteConfig: different categories may use entirely different placeholder syntax', async () => {
  const definitions = await readCategoryDefinitions();
  const map = buildMailsuiteConfigMap(definitions);

  const coldOutreach = map.get('cold outreach');
  const partnership = map.get('partnership');
  assert.notEqual(
    coldOutreach.placeholders.name,
    partnership.placeholders.name,
    'placeholder syntax is per-template, not assumed global — see the pivot doc',
  );
});
