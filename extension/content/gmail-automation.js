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
  // See the matching guard in gmail-dom.js: background.js may re-inject
  // this file if the readiness ping fails, so guard against registering a
  // second chrome.runtime.onMessage listener on an already-live page — two
  // listeners would both respond to PROSPECT_REACH_RUN_ROW, risking a
  // double-send of the same email.
  if (window.__prospectReachAutomationInjected) return;
  window.__prospectReachAutomationInjected = true;

  const dom = window.__prospectReachGmailDom;

  const ACTION_TIMEOUT_MS = 15000;
  const TEMPLATE_INSERT_TIMEOUT_MS = 20000;

  /**
   * Opens a new compose window pre-filled with the recipient and subject,
   * by clicking a `mailto:` link.
   *
   * History (2026-08) — every attempt at directly simulating the To field's
   * People Kit autocomplete (bulk value-set, per-keystroke typing +
   * Enter/suggestion-click, a paste event) produced a recipient chip that
   * looked fully correct in the DOM — a real `[email="..."]` element,
   * passing every check available — but got silently wiped later, once
   * mid-way through selecting the Mailsuite template. Most likely cause:
   * synthetic `dispatchEvent()` input is never browser-trusted
   * (isTrusted: false); Gmail's UI may render an optimistic chip for it but
   * never actually register it in real backend/session state, so the first
   * genuine state reconciliation (most likely Mailsuite silently saving the
   * draft when its panel opens, to get a message ID) pulls back real state
   * that never had our fake entry and wipes it.
   *
   * A `view=cm&to=&su=` full-page-navigation compose-prefill URL was also
   * tried — Gmail's own handling DID reliably register the recipient that
   * way, but the navigation reset Mailsuite's content script to a slow cold
   * start and its toolbar button never got injected into that compose
   * window at all, a hard blocker since Mailsuite is central to this flow.
   *
   * This version gets the best of both: clicking a `mailto:` link Gmail
   * itself intercepts (confirmed 2026-08) opens an inline compose, natively
   * pre-filled through Gmail's own genuine handling — same reliability as
   * the URL approach — without any page navigation at all, so the page
   * (and Mailsuite, already warm) never reloads.
   * @param {string} to
   * @param {string} subject
   * @returns {Promise<Element>} the compose dialog element.
   */
  async function openCompose(to, subject) {
    const dialogsBefore = document.querySelectorAll(dom.GMAIL.composeDialogs.join(',')).length;

    const mailtoLink = document.createElement('a');
    mailtoLink.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}`;
    mailtoLink.style.display = 'none';
    document.body.appendChild(mailtoLink);
    try {
      dom.simulateClick(mailtoLink);
    } finally {
      mailtoLink.remove();
    }

    const composeDialog = await dom.waitFor(
      () => {
        const dialogs = document.querySelectorAll(dom.GMAIL.composeDialogs.join(','));
        return dialogs.length > dialogsBefore ? dialogs[dialogs.length - 1] : null;
      },
      { timeoutMs: ACTION_TIMEOUT_MS, description: 'a compose dialog to open after clicking a mailto: link' },
    );

    // Sanity-check Gmail actually pre-filled the recipient rather than
    // assuming it and finding out only much later (see this function's
    // history above — that's exactly what went wrong before).
    try {
      await dom.waitFor(() => composeDialog.querySelector(`[email="${to.replace(/"/g, '\\"')}"]`), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `a recipient chip for "${to}" to be pre-filled via the mailto: link`,
        target: composeDialog,
      });
    } catch (error) {
      const anyEmailElements = Array.from(composeDialog.querySelectorAll('[email]'));
      const emailAttrValues = anyEmailElements.map((el) => el.getAttribute('email'));
      throw new Error(
        `${error.message} Found ${anyEmailElements.length} element(s) with an email="..." attribute in the ` +
          `compose dialog at all (values: ${JSON.stringify(emailAttrValues)}).`,
      );
    }

    const subjectField = await dom.waitFor(() => dom.queryAny(composeDialog, dom.GMAIL.subjectField), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description: 'the Subject field inside the compose dialog (GMAIL.subjectField)',
      target: composeDialog,
    });
    try {
      await dom.waitFor(() => subjectField.value === subject, {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `the Subject field to be pre-filled with "${subject}" via the mailto: link`,
        target: composeDialog,
      });
    } catch (error) {
      // subjectField.value is read fresh here, not baked into the
      // description above — description strings are built once,
      // synchronously, when waitFor() is called.
      throw new Error(`${error.message} Subject field's actual current value: ${JSON.stringify(subjectField.value)}.`);
    }

    return composeDialog;
  }

  /**
   * Clicks Mailsuite's icon in the compose toolbar, waits for its template
   * dropdown, and selects the template matching `mailsuiteTemplateName`.
   * @param {Element} composeDialog
   * @param {string} mailsuiteTemplateName
   * @param {string} to - the row's email address, to checkpoint the
   *   recipient chip's survival at each sub-step (see runSendNowFlow's
   *   2026-08 note: it disappears somewhere in this function specifically).
   * @returns {Promise<number>} the body's text length immediately before the
   *   template-item click, for waitForTemplateInsertion() to compare against.
   */
  async function selectMailsuiteTemplate(composeDialog, mailsuiteTemplateName, to) {
    const mailsuiteIcon = await dom.waitFor(() => dom.queryAny(composeDialog, dom.MAILSUITE.icon), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description:
        'Mailsuite\'s icon in the compose toolbar (MAILSUITE.icon in extension/content/gmail-dom.js — ' +
        'UNVERIFIED placeholder selector, see file header; likely needs patching after a real Gmail pass)',
    });
    dom.simulateClick(mailsuiteIcon);
    assertRecipientStillPresent(composeDialog, to, 'right after clicking the Mailsuite icon (before the dropdown opens)');

    const dropdown = await dom.waitFor(
      () =>
        dom.queryAny(document, dom.MAILSUITE.templateDropdown) ??
        // aria-expanded flipping to "true" on the button we just clicked is
        // a confirmed-real signal (unlike the templateDropdown selector
        // guesses below it) that the panel opened, even if we don't yet
        // know its container's markup — fall back to searching the whole
        // document for the template item in that case.
        (mailsuiteIcon.getAttribute('aria-expanded') === 'true' ? document : null),
      {
        timeoutMs: ACTION_TIMEOUT_MS,
        description:
          "Mailsuite's template dropdown to open (aria-expanded=\"true\" on the Load template button, " +
          'or MAILSUITE.templateDropdown match — UNVERIFIED placeholder)',
      },
    );
    assertRecipientStillPresent(composeDialog, to, 'right after the Mailsuite template dropdown opened (before finding the template item)');

    const pattern = new RegExp(escapeRegExp(mailsuiteTemplateName), 'i');
    // A single synchronous findByText() check here raced Mailsuite's own
    // async load of the template list: aria-expanded flips true (or the
    // panel container appears) the instant the click registers, but the
    // <li> items themselves are fetched/rendered slightly after — a
    // one-shot check right at that instant can see 0 items even though the
    // real list appears a beat later. Poll for it like every other
    // DOM-dependent step in this file, instead of checking once.
    let templateItem;
    try {
      templateItem = await dom.waitFor(() => dom.findByText(dropdown, dom.MAILSUITE.templateItem.join(','), pattern), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `a Mailsuite template item matching "${mailsuiteTemplateName}" to appear in the template dropdown`,
        target: dropdown === document ? document.body : dropdown,
      });
    } catch (error) {
      // Debug context appended to the thrown message (surfaces directly in
      // the side panel's status text) rather than requiring a DevTools
      // round-trip: exactly what scope was searched, and how many
      // MAILSUITE.templateItem candidates existed there at timeout — pins
      // down "wrong scope" vs. "right scope, selector doesn't match" vs.
      // "right scope, right selector, name genuinely doesn't match".
      const scopeDescription =
        dropdown === document
          ? 'document'
          : `<${dropdown.tagName?.toLowerCase()} class="${dropdown.className}" id="${dropdown.id}">`;
      const candidates = Array.from(dropdown.querySelectorAll(dom.MAILSUITE.templateItem.join(',')));
      const candidateTexts = candidates
        .slice(0, 6)
        .map((el) => JSON.stringify(el.textContent?.trim()))
        .join(', ');
      throw new Error(
        `${error.message} Searched scope: ${scopeDescription}; found ${candidates.length} ` +
          `MAILSUITE.templateItem candidate(s) there at timeout${candidates.length ? ` (texts: ${candidateTexts})` : ''}. ` +
          'Either the config\'s mailsuiteTemplateName is wrong/not-yet-real, or ' +
          'MAILSUITE.templateItem/templateDropdown needs patching for the real dropdown markup.',
      );
    }
    assertRecipientStillPresent(composeDialog, to, 'right after finding the Mailsuite template item (before clicking it)');

    // Capture the body's length right here, immediately before the click —
    // confirmed 2026-08: Mailsuite inserts the template's HTML synchronously
    // inside the click's own event dispatch (it's a cached/local template,
    // no network round-trip at click time), so by the time this function
    // returns and a caller measures its own "before" baseline, the full
    // content is already present and there's nothing left to detect as an
    // increase. waitForTemplateInsertion() takes this pre-click length
    // rather than computing its own.
    const bodyFieldBeforeInsert = dom.queryAny(composeDialog, dom.GMAIL.bodyField);
    const lengthBeforeInsert = bodyFieldBeforeInsert ? bodyFieldBeforeInsert.textContent.length : 0;

    dom.simulateClick(templateItem);
    assertRecipientStillPresent(composeDialog, to, 'right after clicking the Mailsuite template item');

    return lengthBeforeInsert;
  }

  /**
   * Waits for Mailsuite to actually finish inserting content into the
   * compose body — condition-based (the body's own text content changing),
   * never a fixed timeout. See PROJECT_CALIBRATION.md's Sprint 6 notes for
   * why a fixed timeout is explicitly disallowed here (it previously masked
   * a real stall rather than surfacing it).
   * @param {Element} composeDialog
   * @param {number} initialLength - the body's text length captured by the caller
   *   immediately before clicking the template item (see selectMailsuiteTemplate) —
   *   NOT re-measured here, since insertion can already be complete by the
   *   time this function starts (see its 2026-08 note).
   * @returns {Promise<Element>} the compose body field, once populated.
   */
  async function waitForTemplateInsertion(composeDialog, initialLength) {
    // Re-query GMAIL.bodyField fresh on every poll and observe the stable
    // composeDialog ancestor, rather than capturing initialBodyField once
    // and watching/observing that exact node: Mailsuite's template
    // insertion can replace the contenteditable body element wholesale
    // instead of mutating it in place (confirmed 2026-08 — the template
    // visibly inserted but a check pinned to the pre-insertion node/
    // MutationObserver target never saw it), which would otherwise leave
    // us watching a node that's been detached from the live document.
    let bodyField;
    try {
      bodyField = await dom.waitFor(
        () => {
          const current = dom.queryAny(composeDialog, dom.GMAIL.bodyField);
          return current && current.textContent.length > initialLength ? current : null;
        },
        {
          timeoutMs: TEMPLATE_INSERT_TIMEOUT_MS,
          description: "Mailsuite's template content to appear in the compose body (body text length increasing)",
          target: composeDialog,
        },
      );
    } catch (error) {
      // Debug context appended to the thrown message — surfaces directly in
      // the side panel's status text, no DevTools round-trip needed. Pins
      // down: is composeDialog itself detached (Gmail replaced the whole
      // dialog subtree, e.g. finishing its "Loading rich text..." ->
      // ready transition)? Is GMAIL.bodyField still resolvable inside it at
      // all? What's its current text right now vs. initialLength?
      const currentBodyField = dom.queryAny(composeDialog, dom.GMAIL.bodyField);
      throw new Error(
        `${error.message} composeDialog.isConnected=${composeDialog.isConnected}; ` +
          `GMAIL.bodyField currently resolves to: ${currentBodyField ? 'an element' : 'null'}; ` +
          `initialLength=${initialLength}, currentLength=${currentBodyField ? currentBodyField.textContent.length : 'n/a'}; ` +
          `currentText snippet: ${JSON.stringify(currentBodyField?.textContent?.slice(0, 200) ?? '')}`,
      );
    }

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

    try {
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
    } catch (error) {
      // Debug context appended to the thrown message — surfaces directly in
      // the side panel's status text, no DevTools round-trip needed. Also
      // checks the Subject field's current value: the recipient chip has
      // repeatedly survived immediate + 2s-later checks in openCompose but
      // still ended up gone by send time (confirmed 2026-08, across four
      // different commit techniques) — if Subject is ALSO gone/wrong here,
      // that points at something during the Mailsuite template flow
      // resetting the whole compose form, not a recipient-specific problem.
      const emailElements = Array.from(composeDialog.querySelectorAll('[email]'));
      const emailElementDetails = emailElements
        .slice(0, 10)
        .map(
          (el) =>
            `<${el.tagName.toLowerCase()} email="${el.getAttribute('email')}" role="${el.getAttribute('role') ?? ''}" class="${el.className}">`,
        )
        .join(', ');
      const currentSubjectField = dom.queryAny(composeDialog, dom.GMAIL.subjectField);
      throw new Error(
        `${error.message} composeDialog still in document: ${document.body.contains(composeDialog)}; ` +
          `${emailElements.length} [email] element(s) currently in the compose dialog` +
          `${emailElements.length ? ` (${emailElementDetails})` : ''}; ` +
          `Subject field current value: ${JSON.stringify(currentSubjectField?.value ?? 'field not found')}.`,
      );
    }
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Throws a precise, named error if the recipient chip added in
   * openCompose() is no longer present. Confirmed 2026-08: that chip has
   * repeatedly survived openCompose()'s own immediate + 2s-later checks but
   * still ended up missing by the time sendAndConfirm() runs, across four
   * different commit techniques — pointing at something during the
   * Mailsuite template flow, not the commit method itself. Called after
   * each stage in runSendNowFlow() below to pin down exactly which one.
   * @param {Element} composeDialog
   * @param {string} to
   * @param {string} whenDescription - e.g. "right after selecting the Mailsuite template".
   */
  function assertRecipientStillPresent(composeDialog, to, whenDescription) {
    const chipSelector = `[email="${to.replace(/"/g, '\\"')}"]`;
    if (!composeDialog.querySelector(chipSelector)) {
      throw new Error(
        `Recipient chip for "${to}" is missing ${whenDescription} — it was present right after commit in ` +
          'openCompose() (verified there twice, 2s apart) but is gone now.',
      );
    }
  }

  /**
   * Runs the full send-now flow for one row. Never swallows a failure —
   * every step above throws a specific, named error on failure, and this
   * function lets those propagate to the caller (the chrome.runtime message
   * listener below), which reports them back to the background service
   * worker. Matches the old automation.js's per-row isolation philosophy:
   * one row's failure is reported precisely, not silently retried or hidden.
   * @param {{to: string, name: string, company: string}} row
   * @param {{mailsuiteTemplateName: string, subject: string, placeholders: {name: string, company: string}}} mailsuiteConfig
   * @returns {Promise<{success: true, replacedCount: number}>}
   */
  async function runSendNowFlow(row, mailsuiteConfig) {
    const composeDialog = await openCompose(row.to, mailsuiteConfig.subject);

    const lengthBeforeInsert = await selectMailsuiteTemplate(composeDialog, mailsuiteConfig.mailsuiteTemplateName, row.to);
    assertRecipientStillPresent(composeDialog, row.to, 'right after selecting the Mailsuite template (before the body-insertion wait)');

    const bodyField = await waitForTemplateInsertion(composeDialog, lengthBeforeInsert);
    assertRecipientStillPresent(composeDialog, row.to, 'right after the template body finished inserting');

    const replacedCount = personalize(bodyField, mailsuiteConfig.placeholders, {
      name: row.name,
      company: row.company,
    });
    assertRecipientStillPresent(composeDialog, row.to, 'right after personalizing the body');

    await sendAndConfirm(composeDialog);
    return { success: true, replacedCount };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // background.js pings this before sending real work, to confirm the
    // content script is actually alive in this tab (see
    // waitForContentScriptReady in background.js) rather than assuming
    // injection == ready the instant chrome.scripting.executeScript resolves.
    if (message?.type === 'PROSPECT_REACH_PING') {
      sendResponse({ ready: true });
      return undefined;
    }

    if (message?.type !== 'PROSPECT_REACH_RUN_ROW') return undefined;

    runSendNowFlow(message.row, message.mailsuiteConfig)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true; // keep the message channel open for the async sendResponse above
  });
})();
