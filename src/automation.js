/**
 * Drives a real, already-logged-in Chrome window through Gmail's compose
 * UI — not the Gmail API — so every send/schedule behaves exactly like a
 * human using Gmail (and gets picked up by passive trackers like
 * Mailsuite). All DOM selectors live in gmail-selectors.js; nothing here
 * should contain an inline selector string.
 */
import { chromium } from 'playwright';
import { selectors } from './gmail-selectors.js';
import { resolveTemplate } from './templates.js';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';
const ACTION_TIMEOUT_MS = 15000;
const NAV_TIMEOUT_MS = 30000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Launches real Chrome (not the Playwright-bundled Chromium) against the
 * developer's actual Chrome profile, so Gmail is already authenticated —
 * this never builds or drives a login flow.
 * @param {object} options
 * @param {string} options.userDataDir - path to the Chrome profile's user-data directory.
 * @param {boolean} [options.headless] - defaults to false; a human should be able to watch and intervene.
 * @returns {Promise<{context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function launchBrowser({ userDataDir, headless = false } = {}) {
  if (!userDataDir) {
    throw new Error(
      'launchBrowser requires userDataDir — the path to the Chrome profile already logged into the target Gmail account.',
    );
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless,
    viewport: null,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(GMAIL_URL, { timeout: NAV_TIMEOUT_MS });
  await page
    .locator(selectors.composeButton)
    .first()
    .waitFor({ state: 'visible', timeout: NAV_TIMEOUT_MS });

  return { context, page };
}

/**
 * Closes the browser context opened by launchBrowser().
 * @param {import('playwright').BrowserContext} context
 */
export async function closeBrowser(context) {
  await context.close();
}

/**
 * Opens a new Gmail compose window and fills To/Subject/Body.
 * @param {import('playwright').Page} page
 * @param {{to: string, subject: string, body: string}} message
 * @returns {Promise<import('playwright').Locator>} a locator scoped to this compose dialog, for send/schedule to act on.
 */
export async function composeMessage(page, { to, subject, body }) {
  const dialogsBefore = await page.locator(selectors.composeDialog).count();

  await page.locator(selectors.composeButton).first().click({ timeout: ACTION_TIMEOUT_MS });

  const composeHandle = page.locator(selectors.composeDialog).nth(dialogsBefore);
  await composeHandle.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });

  const toField = composeHandle.locator(selectors.toField).first();
  await toField.click({ timeout: ACTION_TIMEOUT_MS });
  await toField.fill(to, { timeout: ACTION_TIMEOUT_MS });

  await composeHandle
    .locator(selectors.subjectField)
    .fill(subject, { timeout: ACTION_TIMEOUT_MS });

  const bodyField = composeHandle.locator(selectors.bodyField);
  await bodyField.click({ timeout: ACTION_TIMEOUT_MS });
  await bodyField.fill(body, { timeout: ACTION_TIMEOUT_MS });

  return composeHandle;
}

/**
 * Clicks Send and confirms the message actually went out — never assumes
 * success just because no exception was thrown.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} composeHandle
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendNow(page, composeHandle) {
  try {
    await composeHandle
      .locator(selectors.sendButton)
      .first()
      .click({ timeout: ACTION_TIMEOUT_MS });

    await Promise.race([
      page.locator(selectors.sentToast).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }),
      composeHandle.waitFor({ state: 'detached', timeout: ACTION_TIMEOUT_MS }),
    ]);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Schedules the message via Gmail's native "Schedule send" flow and
 * verifies Gmail's own confirmation toast — never falls back to send-now.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} composeHandle
 * @param {{date: string, time: string}} schedule - values typed into Gmail's native date/time inputs (format depends on the account's locale — confirm against the real UI before relying on this).
 * @returns {Promise<{success: boolean}>} rejects with a descriptive error naming the missing selector if any step fails.
 */
export async function scheduleSend(page, composeHandle, { date, time } = {}) {
  const dropdownArrow = composeHandle.locator(selectors.sendDropdownArrow).first();
  try {
    await dropdownArrow.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  } catch {
    throw new Error(
      `scheduleSend: could not find the send-options dropdown (selectors.sendDropdownArrow = "${selectors.sendDropdownArrow}"). Gmail's compose toolbar may have changed.`,
    );
  }
  await dropdownArrow.click({ timeout: ACTION_TIMEOUT_MS });

  const scheduleMenuItem = page.locator(selectors.scheduleSendMenuItem).first();
  try {
    await scheduleMenuItem.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  } catch {
    throw new Error(
      `scheduleSend: could not find the "Schedule send" menu item (selectors.scheduleSendMenuItem = "${selectors.scheduleSendMenuItem}"). Gmail's send-options menu may have changed.`,
    );
  }
  await scheduleMenuItem.click({ timeout: ACTION_TIMEOUT_MS });

  const dialog = page.locator(selectors.scheduleSendDialog).first();
  try {
    await dialog.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  } catch {
    throw new Error(
      `scheduleSend: the schedule dialog (selectors.scheduleSendDialog = "${selectors.scheduleSendDialog}") never appeared.`,
    );
  }

  if (date) {
    await dialog.locator(selectors.scheduleDateInput).fill(date, { timeout: ACTION_TIMEOUT_MS });
  }
  if (time) {
    await dialog.locator(selectors.scheduleTimeInput).fill(time, { timeout: ACTION_TIMEOUT_MS });
  }

  try {
    await dialog
      .locator(selectors.scheduleSendConfirmButton)
      .first()
      .click({ timeout: ACTION_TIMEOUT_MS });
  } catch {
    throw new Error(
      `scheduleSend: could not find/click the schedule confirm button (selectors.scheduleSendConfirmButton = "${selectors.scheduleSendConfirmButton}").`,
    );
  }

  try {
    await page
      .locator(selectors.scheduledToast)
      .first()
      .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  } catch {
    throw new Error(
      'scheduleSend: confirmed the dialog but no scheduled-confirmation toast appeared — the send may not actually be scheduled.',
    );
  }

  return { success: true };
}

/**
 * Runs one row (compose → send or schedule) end to end, isolated from the
 * batch loop so a bad row's exception can be caught by the caller.
 * @param {import('playwright').Page} page
 * @param {object} row - a Sprint 1 "ready" row (or any object with name/email/company/category, any casing).
 * @param {'send' | 'schedule'} mode
 * @param {{date?: string, time?: string}} scheduleFor
 * @param {Record<string, object>} categories - output of templates.loadCategoryTemplates().
 */
async function runRow(page, row, mode, scheduleFor, categories) {
  const email = row.email ?? row.Email ?? '';
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`Malformed recipient email: "${email}"`);
  }

  const categoryName = row.category ?? row.Category ?? '';
  const categoryJson = categories?.[categoryName.trim().toLowerCase()];
  if (!categoryJson) {
    throw new Error(`No template found for category "${categoryName}"`);
  }

  const message = resolveTemplate(categoryJson, row);
  const composeHandle = await composeMessage(page, message);

  if (mode === 'schedule') {
    await scheduleSend(page, composeHandle, scheduleFor ?? {});
    return;
  }

  const result = await sendNow(page, composeHandle);
  if (!result.success) {
    throw new Error(result.error ?? 'sendNow reported failure with no error message');
  }
}

/**
 * Processes rows one at a time (Gmail UI automation is not safely
 * parallelizable), isolating each row's failure so one bad row never aborts
 * the batch. Defensive independently of Sprint 1's validation — a malformed
 * email that slipped through is still caught here.
 * @param {object[]} rows - ready rows to send/schedule.
 * @param {object} options
 * @param {'send' | 'schedule'} options.mode
 * @param {{date?: string, time?: string}} [options.scheduleFor] - required when mode === 'schedule'.
 * @param {Record<string, object>} options.categories - output of templates.loadCategoryTemplates().
 * @param {import('playwright').Page} options.page - page from launchBrowser().
 * @returns {Promise<{succeeded: Array<{row: number, email: string}>, failed: Array<{row: number, email: string, error: string}>}>}
 */
export async function runBatch(rows, { mode, scheduleFor, categories, page }) {
  const succeeded = [];
  const failed = [];

  for (const row of rows) {
    const email = row.email ?? row.Email ?? '';
    try {
      // eslint-disable-next-line no-await-in-loop
      await runRow(page, row, mode, scheduleFor, categories);
      succeeded.push({ row: row.__row, email });
    } catch (error) {
      failed.push({ row: row.__row, email, error: error.message });
    }
  }

  return { succeeded, failed };
}
