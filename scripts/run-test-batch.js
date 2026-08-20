/**
 * Manual test batch for the Playwright automation layer. This is NOT part
 * of `npm test` — it drives a real, visible Chrome window against a real
 * Gmail account and actually sends/schedules mail.
 *
 * Precondition: CHROME_PROFILE_DIR must point at a Chrome user-data
 * directory that is already logged into a test Gmail account (a throwaway
 * account, not a real rep's inbox) — this script builds no login flow and
 * expects Gmail to already be authenticated when the window opens. No
 * credentials are read or stored by this script or anywhere in the repo.
 *
 * Run with, e.g.:
 *   CHROME_PROFILE_DIR="/path/to/chrome/profile" node scripts/run-test-batch.js
 *
 * On Windows this is typically a copy of a folder under
 * %LOCALAPPDATA%\Google\Chrome\User Data — use a copy, not your live
 * profile, so this script can't collide with a Chrome window you're using.
 */
import { closeBrowser, launchBrowser, runBatch } from '../src/automation.js';
import { loadCategoryTemplates } from '../src/templates.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATEGORIES_DIR = join(__dirname, '..', 'templates', 'categories');

// Styled after scripts/generate-test-sheet.js's fixture shape — mirrors the
// `{ __row, name, email, company, category }` shape src/excel.js produces.
const FIXTURE_ROWS = [
  { __row: 2, name: 'Alice Adams', email: 'alice@example.com', company: 'Alpha Inc', category: 'Partnership' },
  { __row: 3, name: 'Bob Brown', email: 'bob@example.com', company: 'Beta LLC', category: 'Cold Outreach' },
  { __row: 4, name: 'Carol Chen', email: 'not-an-email', company: 'Gamma Co', category: 'Newsletter' }, // deliberately bad
  { __row: 5, name: 'Dan Diaz', email: 'dan@example.com', company: 'Delta Ltd', category: 'Partnership' },
  { __row: 6, name: 'Eve Evans', email: 'eve@example.com', company: 'Epsilon Co', category: 'Cold Outreach' },
  { __row: 7, name: 'Frank Faulk', email: 'frank@example.com', company: 'Zeta Co', category: 'Newsletter' },
];

// First half exercises send-now, second half exercises schedule-send.
const SEND_ROWS = FIXTURE_ROWS.slice(0, 3);
const SCHEDULE_ROWS = FIXTURE_ROWS.slice(3);

// Placeholder date/time — adjust to match your Gmail account's locale and
// to a real future slot before running; Gmail's scheduler UI rejects past times.
const SCHEDULE_FOR = { date: '12/31/2026', time: '9:00 AM' };

async function main() {
  const userDataDir = process.env.CHROME_PROFILE_DIR;
  if (!userDataDir) {
    console.error(
      'Set CHROME_PROFILE_DIR to a Chrome profile directory already logged into your test Gmail account. See the comment at the top of this script.',
    );
    process.exitCode = 1;
    return;
  }

  const categories = await loadCategoryTemplates(CATEGORIES_DIR);
  const { context, page } = await launchBrowser({ userDataDir, headless: false });

  try {
    console.log(`Sending ${SEND_ROWS.length} rows now...`);
    const sendResult = await runBatch(SEND_ROWS, { mode: 'send', categories, page });

    console.log(`Scheduling ${SCHEDULE_ROWS.length} rows for ${SCHEDULE_FOR.date} ${SCHEDULE_FOR.time}...`);
    const scheduleResult = await runBatch(SCHEDULE_ROWS, {
      mode: 'schedule',
      scheduleFor: SCHEDULE_FOR,
      categories,
      page,
    });

    const summary = {
      succeeded: [...sendResult.succeeded, ...scheduleResult.succeeded],
      failed: [...sendResult.failed, ...scheduleResult.failed],
    };

    console.log('Batch summary:', JSON.stringify(summary, null, 2));
  } finally {
    await closeBrowser(context);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
