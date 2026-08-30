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
   *
   * NEW STRATEGY (2026-08): stopped trying to make the recipient survive
   * the Mailsuite template flow at all. This mailto: fill is now only a
   * best-effort first attempt — its own checks below are downgraded to
   * console.warn, not throw, specifically so a failure here does NOT stop
   * the flow. The recipient field is filled for real, authoritatively, at
   * the very end of runSendNowFlow() via fillRecipientAtEnd() — after
   * Mailsuite has already finished touching the DOM, using the same
   * simulateClick() + simulateTyping()/simulateEnterKey() sequence proven
   * to reliably register a real chip. Subject is left to this mailto: fill
   * only (not re-filled at the end) since it's never been reported missing
   * the way the recipient has been.
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

    // Best-effort only — see this function's NEW STRATEGY note above. The
    // authoritative recipient fill+check happens at the end of
    // runSendNowFlow() via fillRecipientAtEnd(), not here.
    await dom
      .waitFor(() => composeDialog.querySelector(`[email="${to.replace(/"/g, '\\"')}"]`), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `a recipient chip for "${to}" to be pre-filled via the mailto: link`,
        target: composeDialog,
      })
      .catch((error) => {
        console.warn(
          `[Prospect Reach] ${error.message} (non-fatal — this is only a best-effort early attempt; ` +
            'the real recipient fill happens at the end, via fillRecipientAtEnd()).',
        );
      });

    const subjectField = await dom.waitFor(() => dom.queryAny(composeDialog, dom.GMAIL.subjectField), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description: 'the Subject field inside the compose dialog (GMAIL.subjectField)',
      target: composeDialog,
    });
    await dom
      .waitFor(() => subjectField.value === subject, {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `the Subject field to be pre-filled with "${subject}" via the mailto: link`,
        target: composeDialog,
      })
      .catch((error) => {
        console.warn(
          `[Prospect Reach] ${error.message} Subject field's actual current value: ` +
            `${JSON.stringify(subjectField.value)} (non-fatal).`,
        );
      });

    return composeDialog;
  }

  /**
   * Clicks Mailsuite's icon in the compose toolbar, waits for its template
   * dropdown, and selects the template matching `mailsuiteTemplateName`.
   *
   * No recipient-chip checkpoints in here anymore (2026-08) — under the
   * current strategy the recipient is expected to be absent/unreliable
   * through this whole function; it gets filled for real afterward, see
   * fillRecipientAtEnd() and runSendNowFlow()'s NEW STRATEGY note.
   * @param {Element} composeDialog
   * @param {string} mailsuiteTemplateName
   * @returns {Promise<number>} the body's text length immediately before the
   *   template-item click, for waitForTemplateInsertion() to compare against.
   */
  async function selectMailsuiteTemplate(composeDialog, mailsuiteTemplateName) {
    const mailsuiteIcon = await dom.waitFor(() => dom.queryAny(composeDialog, dom.MAILSUITE.icon), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description:
        'Mailsuite\'s icon in the compose toolbar (MAILSUITE.icon in extension/content/gmail-dom.js — ' +
        'UNVERIFIED placeholder selector, see file header; likely needs patching after a real Gmail pass)',
    });
    dom.simulateClick(mailsuiteIcon);

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
      // the side panel's status text, no DevTools round-trip needed.
      // Recipient is now filled right before this function runs (see
      // fillRecipientAtEnd() and runSendNowFlow()'s NEW STRATEGY note), so
      // a missing chip here would be a genuinely new failure mode, not the
      // old "wiped sometime during the Mailsuite flow" bug this diagnostic
      // was originally added to chase.
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
   * Fills the recipient field for real, authoritatively, at the very end of
   * the flow — after Mailsuite has already finished touching the compose
   * DOM (template selected, content inserted, personalized). This is the
   * NEW STRATEGY (2026-08): rather than continuing to chase why an early
   * recipient fill (mailto: link, and before that, direct typing) kept
   * getting silently wiped somewhere during the Mailsuite template flow,
   * sidestep the question entirely by filling the recipient only after
   * that flow is done touching the page. Uses the exact same interaction
   * primitives already proven to work reliably elsewhere in this file —
   * simulateClick() (used for the Mailsuite icon and template item clicks)
   * plus simulateTyping()/simulateEnterKey() (real per-character
   * keydown/input/keyup events + a real Enter keypress, the same approach
   * that reliably produced a correctly-rendered chip during earlier field
   * testing, before it was replaced by the mailto: link).
   *
   * This is the one authoritative, blocking recipient check in the whole
   * flow — if the chip still isn't there after this, something is
   * seriously wrong (or the row's email is malformed) and the send must
   * not proceed.
   * @param {Element} composeDialog
   * @param {string} to
   * @returns {Promise<void>}
   */
  async function fillRecipientAtEnd(composeDialog, to) {
    const toField = await dom.waitFor(() => dom.queryAny(composeDialog, dom.GMAIL.toField), {
      timeoutMs: ACTION_TIMEOUT_MS,
      description: 'the To field inside the compose dialog (GMAIL.toField), to fill the recipient at the end',
      target: composeDialog,
    });

    dom.simulateClick(toField);
    dom.simulateTyping(toField, to);
    dom.simulateEnterKey(toField);

    try {
      await dom.waitFor(() => composeDialog.querySelector(`[email="${to.replace(/"/g, '\\"')}"]`), {
        timeoutMs: ACTION_TIMEOUT_MS,
        description: `a recipient chip for "${to}" to appear after clicking + typing into the To field (end-of-flow fill)`,
        target: composeDialog,
      });
    } catch (error) {
      const anyEmailElements = Array.from(composeDialog.querySelectorAll('[email]'));
      const emailAttrValues = anyEmailElements.map((el) => el.getAttribute('email'));
      throw new Error(
        `${error.message} Found ${anyEmailElements.length} element(s) with an email="..." attribute in the ` +
          `compose dialog at all (values: ${JSON.stringify(emailAttrValues)}). Current To field value: ` +
          `${JSON.stringify(toField.value ?? toField.textContent ?? '')}.`,
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
   *
   * NEW STRATEGY (2026-08): the recipient is filled LAST, after Mailsuite's
   * template selection/insertion/personalization are all done — not first.
   * Every earlier approach (mailto: link, and before that, direct typing)
   * filled the recipient before Mailsuite touched the page, and the chip
   * kept getting silently wiped somewhere during that flow across multiple
   * different fill techniques — pointing at something Mailsuite's own flow
   * does to the compose form, not the fill method. Filling afterward
   * sidesteps that entirely instead of continuing to chase its root cause.
   * @param {{to: string, name: string, company: string}} row
   * @param {{mailsuiteTemplateName: string, subject: string, placeholders: {name: string, company: string}}} mailsuiteConfig
   * @returns {Promise<{success: true, replacedCount: number}>}
   */
  async function runSendNowFlow(row, mailsuiteConfig) {
    const composeDialog = await openCompose(row.to, mailsuiteConfig.subject);

    const lengthBeforeInsert = await selectMailsuiteTemplate(composeDialog, mailsuiteConfig.mailsuiteTemplateName);
    const bodyField = await waitForTemplateInsertion(composeDialog, lengthBeforeInsert);
    const replacedCount = personalize(bodyField, mailsuiteConfig.placeholders, {
      name: row.name,
      company: row.company,
    });

    await fillRecipientAtEnd(composeDialog, row.to);

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
