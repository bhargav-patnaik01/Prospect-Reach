/**
 * The actual Gmail/Mailsuite compose→send flow — send-now only this sprint
 * (Sprint 6); schedule-send is deliberately deferred to Sprint 7 (see
 * PROJECT_CALIBRATION.md's Sprint 6 notes for why: it was the most
 * DOM-fragile part of the original Playwright build, and mixing that
 * fragility into "does Mailsuite automation work at all" makes both harder
 * to debug).
 *
 * Injected as a plain classic script (see manifest.json) alongside
 * gmail-dom.js, which must run first — this file reads
 * `window.__prospectReachGmailDom`. Runs in the dedicated Gmail tab created
 * by the background service worker (see background.js and Decision #1 in
 * PROJECT_CALIBRATION.md's Sprint 6 notes), not in whatever Gmail tab the
 * rep already had open.
 *
 * Lifecycle note (Decision #2 in PROJECT_CALIBRATION.md's Sprint 6 notes):
 * this content script — not the background service worker — is what
 * actually runs the multi-second/multi-step wait loop below. A content
 * script keeps running as long as its tab is open; it isn't subject to the
 * service worker's 30-second-idle-kill lifecycle at all. The service worker
 * only sends one "run this row" message and awaits one reply.
 */
(function () {
  const dom = window.__prospectReachGmailDom;

  const ACTION_TIMEOUT_MS = 15000;
  const TEMPLATE_INSERT_TIMEOUT_MS = 20000;

  /**
   * Opens a new compose window and fills the To field.
   * @param {string} to
   * @returns {Promise<Element>} the compose dialog element.
   */
  async function openCompose(to) {
    const composeButton = await dom.waitFor(() => dom.queryAny(document, dom.GMAIL.composeButton), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description: 'Gmail compose button (GMAIL.composeButton in extension/content/gmail-dom.js)',
    });

    const dialogsBefore = document.querySelectorAll(dom.GMAIL.composeDialogs.join(',')).length;
    dom.simulateClick(composeButton);

    const composeDialog = await dom.waitFor(
      () => {
        const dialogs = document.querySelectorAll(dom.GMAIL.composeDialogs.join(','));
        return dialogs.length > dialogsBefore ? dialogs[dialogs.length - 1] : null;
      },
      { timeoutMs: ACTION_TIMEOUT_MS, description: 'a new compose dialog to appear after clicking Compose' },
    );

    const toField = dom.queryAny(composeDialog, dom.GMAIL.toField);
    if (!toField) {
      throw new Error('Could not find the To field inside the new compose dialog (GMAIL.toField).');
    }
    dom.setEditableContent(toField, to);

    return composeDialog;
  }

  /**
   * Clicks Mailsuite's icon in the compose toolbar, waits for its template
   * dropdown, and selects the template matching `mailsuiteTemplateName`.
   * @param {Element} composeDialog
   * @param {string} mailsuiteTemplateName
   */
  async function selectMailsuiteTemplate(composeDialog, mailsuiteTemplateName) {
    const mailsuiteIcon = await dom.waitFor(() => dom.queryAny(composeDialog, dom.MAILSUITE.icon), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description:
        'Mailsuite\'s icon in the compose toolbar (MAILSUITE.icon in extension/content/gmail-dom.js — ' +
        'UNVERIFIED placeholder selector, see file header; likely needs patching after a real Gmail pass)',
    });
    dom.simulateClick(mailsuiteIcon);

    const dropdown = await dom.waitFor(() => dom.queryAny(document, dom.MAILSUITE.templateDropdown), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description: "Mailsuite's template dropdown to open (MAILSUITE.templateDropdown — UNVERIFIED placeholder)",
    });

    const pattern = new RegExp(escapeRegExp(mailsuiteTemplateName), 'i');
    const templateItem = dom.findByText(dropdown, dom.MAILSUITE.templateItem.join(','), pattern);
    if (!templateItem) {
      throw new Error(
        `Could not find a Mailsuite template item matching "${mailsuiteTemplateName}" in the ` +
          'template dropdown. Either the config\'s mailsuiteTemplateName is wrong/not-yet-real, or ' +
          'MAILSUITE.templateItem needs patching for the real dropdown markup.',
      );
    }
    dom.simulateClick(templateItem);
  }

  /**
   * Waits for Mailsuite to actually finish inserting content into the
   * compose body — condition-based (the body's own text content changing),
   * never a fixed timeout. See PROJECT_CALIBRATION.md's Sprint 6 notes for
   * why a fixed timeout is explicitly disallowed here (it previously masked
   * a real stall rather than surfacing it).
   * @param {Element} composeDialog
   * @returns {Promise<Element>} the compose body field, once populated.
   */
  async function waitForTemplateInsertion(composeDialog) {
    const bodyField = dom.queryAny(composeDialog, dom.GMAIL.bodyField);
    if (!bodyField) {
      throw new Error('Could not find the compose body field (GMAIL.bodyField) to watch for template insertion.');
    }

    const initialLength = bodyField.textContent.length;
    await dom.waitFor(() => bodyField.textContent.length > initialLength, {
      timeoutMs: TEMPLATE_INSERT_TIMEOUT_MS,
      description: "Mailsuite's template content to appear in the compose body (body text length increasing)",
      target: bodyField,
    });

    return bodyField;
  }

  /**
   * Replaces a category's placeholder strings with real row data, in place,
   * preserving whatever formatting Mailsuite's template inserted.
   * @param {Element} bodyField
   * @param {{name: string, company: string}} placeholders - e.g. { name: "[First Name]", company: "[Company]" }
   * @param {{name: string, company: string}} personalization - real row values.
   * @returns {number} total placeholder occurrences replaced.
   */
  function personalize(bodyField, placeholders, personalization) {
    return dom.replaceTextInElement(bodyField, {
      [placeholders.name]: personalization.name,
      [placeholders.company]: personalization.company,
    });
  }

  /**
   * Clicks Send and confirms the message actually went out — the same
   * confirmation rigor as the old automation.js's sendNow(): success is
   * "the sent-confirmation toast appeared, or the compose dialog closed,"
   * never just "no exception was thrown."
   * @param {Element} composeDialog
   */
  async function sendAndConfirm(composeDialog) {
    const sendButton = dom.queryAny(composeDialog, dom.GMAIL.sendButton);
    if (!sendButton) {
      throw new Error('Could not find the Send button (GMAIL.sendButton) in the compose dialog.');
    }
    dom.simulateClick(sendButton);

    await Promise.race([
      dom.waitFor(() => dom.findByText(document, 'div,span', dom.SENT_TOAST_TEXT), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: 'the "Message sent" confirmation toast',
      }),
      dom.waitFor(() => (document.body.contains(composeDialog) ? null : true), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: 'the compose dialog to close after sending',
      }),
    ]);
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Runs the full send-now flow for one row. Never swallows a failure —
   * every step above throws a specific, named error on failure, and this
   * function lets those propagate to the caller (the chrome.runtime message
   * listener below), which reports them back to the background service
   * worker. Matches the old automation.js's per-row isolation philosophy:
   * one row's failure is reported precisely, not silently retried or hidden.
   * @param {{to: string, name: string, company: string}} row
   * @param {{mailsuiteTemplateName: string, placeholders: {name: string, company: string}}} mailsuiteConfig
   * @returns {Promise<{success: true, replacedCount: number}>}
   */
  async function runSendNowFlow(row, mailsuiteConfig) {
    const composeDialog = await openCompose(row.to);
    await selectMailsuiteTemplate(composeDialog, mailsuiteConfig.mailsuiteTemplateName);
    const bodyField = await waitForTemplateInsertion(composeDialog);
    const replacedCount = personalize(bodyField, mailsuiteConfig.placeholders, {
      name: row.name,
      company: row.company,
    });
    await sendAndConfirm(composeDialog);
    return { success: true, replacedCount };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PROSPECT_REACH_RUN_ROW') return undefined;

    runSendNowFlow(message.row, message.mailsuiteConfig)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true; // keep the message channel open for the async sendResponse above
  });
})();
