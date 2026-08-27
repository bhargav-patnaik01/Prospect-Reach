/**
 * Background service worker.
 *
 * Two responsibilities:
 *  1. Wire the toolbar icon to open the side panel (unchanged from Sprint 5).
 *  2. Orchestrate a single-row send-now run: create a dedicated Gmail tab,
 *     inject the content script, hand it one row + its category's Mailsuite
 *     config, and relay the result back to whoever asked (the side panel).
 *
 * Declared as an ES module (`"type": "module"` in manifest.json) so it can
 * `import` extension/lib/mailsuite-config.js directly, the same shared
 * module the Node side (src/mailsuite-config.js) and its tests use.
 *
 * --- Decision #1: dedicated new tab, not the rep's open Gmail tab ---
 * See PROJECT_CALIBRATION.md's Sprint 6 notes for the full reasoning. Short
 * version: a rep reading/replying to their own inbox in the same tab the
 * automation is driving is a bad experience and a real risk of the
 * automation and the human fighting over the same compose window. A
 * dedicated tab (chrome.tabs.create) costs nothing extra — same logged-in
 * session, same Mailsuite — and cleanly separates "the tool's work" from
 * "the rep's own Gmail use" happening at the same time.
 *
 * --- Decision #2: keep-alive / lifecycle strategy — the hybrid ---
 * See PROJECT_CALIBRATION.md's Sprint 6 notes for the full reasoning and
 * sources (Chrome's official service worker lifecycle docs, fetched fresh
 * for this sprint rather than relying on training-data knowledge, since
 * this API surface has shifted over time). Short version: this service
 * worker does NOT run the multi-step wait/interact loop itself — that
 * entire loop lives in the content script (extension/content/
 * gmail-automation.js), which keeps running as long as its dedicated tab
 * stays open and is not subject to the service worker's 30-second-idle-kill
 * lifecycle at all. This service worker's job is only to: create the tab,
 * inject the script, send ONE message, and await ONE reply — a single
 * request/response pair, not a loop it has to stay alive across. Per
 * Chrome's docs, "receiving an event or calling an extension API resets"
 * the 30-second idle timer, so this worker naturally stays alive for the
 * duration of the awaited chrome.tabs.sendMessage() call below; the
 * documented 5-minute hard cap on a single event's processing time is not a
 * concern for one row (~15-35s in practice, per the content script's own
 * per-step timeouts). Sprint 7's multi-row batch loop will need to avoid
 * running many rows sequentially inside one single onMessage callback (that
 * could approach the 5-minute cap) — the fix there is looping via repeated
 * short message round-trips, not one long-lived callback; not built here
 * since batch looping is explicitly out of scope for this sprint.
 */
import { buildMailsuiteConfigMap } from './lib/mailsuite-config.js';

const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';
const TAB_LOAD_TIMEOUT_MS = 30000;
const ROW_RUN_STORAGE_KEY = 'prospectReachLastRun';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior:', error));

/**
 * Loads every bundled category definition and builds the category ->
 * Mailsuite config map, the same way the extension's Excel layer builds its
 * known-categories set (see extension/lib/browser-excel.js) — via the
 * build-time-generated templates/categories/index.json file list.
 * @returns {Promise<Map<string, object>>}
 */
async function loadMailsuiteConfigMap() {
  const indexUrl = chrome.runtime.getURL('templates/categories/index.json');
  const fileNames = await (await fetch(indexUrl)).json();

  const definitions = await Promise.all(
    fileNames.map(async (fileName) => {
      const url = chrome.runtime.getURL(`templates/categories/${fileName}`);
      return (await fetch(url)).json();
    }),
  );

  return buildMailsuiteConfigMap(definitions);
}

/**
 * Opens a dedicated Gmail tab and resolves once it's finished loading.
 * @returns {Promise<number>} the new tab's id.
 */
function openDedicatedGmailTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: GMAIL_URL, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'chrome.tabs.create returned no tab id'));
        return;
      }

      const tabId = tab.id;
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(`Timed out waiting for the dedicated Gmail tab (id ${tabId}) to finish loading.`));
      }, TAB_LOAD_TIMEOUT_MS);

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(tabId);
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

/** Injects the content script pair (order matters — gmail-dom.js first). */
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/gmail-dom.js', 'content/gmail-automation.js'],
  });
}

/**
 * Runs the full single-row send-now flow: dedicated tab -> inject -> one
 * row message -> one reply. This is the whole orchestration skeleton this
 * sprint proves out before Sprint 7 loops it over a batch.
 * @param {{name: string, email: string, company: string, category: string}} row
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function runSingleRow(row) {
  await chrome.storage.session.set({ [ROW_RUN_STORAGE_KEY]: { row, status: 'starting' } });

  const configMap = await loadMailsuiteConfigMap();
  const mailsuiteConfig = configMap.get((row.category ?? '').trim().toLowerCase());
  if (!mailsuiteConfig) {
    const result = { success: false, error: `No Mailsuite config found for category "${row.category}".` };
    await chrome.storage.session.set({ [ROW_RUN_STORAGE_KEY]: { row, status: 'error', result } });
    return result;
  }

  const tabId = await openDedicatedGmailTab();
  await chrome.storage.session.set({ [ROW_RUN_STORAGE_KEY]: { row, status: 'tab-open', tabId } });

  await injectContentScript(tabId);
  await chrome.storage.session.set({ [ROW_RUN_STORAGE_KEY]: { row, status: 'script-injected', tabId } });

  const result = await chrome.tabs.sendMessage(tabId, {
    type: 'PROSPECT_REACH_RUN_ROW',
    row: { to: row.email, name: row.name, company: row.company },
    mailsuiteConfig,
  });

  await chrome.storage.session.set({ [ROW_RUN_STORAGE_KEY]: { row, status: 'done', tabId, result } });
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PROSPECT_REACH_SEND_TEST_ROW') return undefined;

  runSingleRow(message.row)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true; // keep the message channel open for the async sendResponse above
});
