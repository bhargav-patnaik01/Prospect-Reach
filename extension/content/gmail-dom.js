/**
 * Gmail/Mailsuite DOM helpers for the content script — the browser-DOM
 * translation of src/gmail-selectors.js's Playwright-era selector knowledge
 * (compose button, compose dialog, body field, send button all originate
 * there). This is deliberately NOT a verbatim copy the way
 * src/validate.js/src/sheet-rows.js are copied by scripts/build-extension.js:
 * src/gmail-selectors.js uses Playwright-only pseudo-selector syntax
 * (`:has-text(...)`, `text=...`) that plain `document.querySelector` does
 * not understand, so every selector here had to be re-expressed as valid
 * CSS plus a small text-matching helper. See PROJECT_CALIBRATION.md's
 * Sprint 6 notes for the full explanation of why this couldn't be a copy.
 *
 * IMPORTANT — Mailsuite selectors below (MAILSUITE_ICON_SELECTORS,
 * MAILSUITE_TEMPLATE_DROPDOWN_SELECTORS, MAILSUITE_TEMPLATE_ITEM_SELECTOR)
 * are BEST-GUESS PLACEHOLDERS. Unlike the Gmail-native selectors (which
 * trace back to Sprint 3's real, debugged Playwright automation),
 * `src/gmail-selectors.js` was written before any Mailsuite integration
 * existed — Mailsuite was never installed on a dev machine, so no one has
 * ever actually inspected its real compose-window DOM. These are informed
 * guesses (Mailsuite is a small toolbar icon injected into Gmail's compose
 * toolbar; most such extensions expose an aria-label/title with the
 * extension's name), not verified selectors. Expect to patch this file
 * after the first real "Load Unpacked" + real Gmail/Mailsuite pass — see
 * the manual verification checklist in the Sprint 6 summary.
 *
 * This file is a plain classic script (no ES `import`/`export`) so it can
 * be injected via chrome.scripting.executeScript's `files` list alongside
 * gmail-automation.js and share globals with it, the same way multiple
 * `content_scripts` entries share a scope — see manifest.json comments.
 */
(function () {
  const GMAIL = {
    composeButton: ['div[role="button"][gh="cm"]'],
    composeDialogs: ['div[role="dialog"]'],
    toField: ['textarea[name="to"]', 'input[aria-label^="To"]'],
    subjectField: ['input[name="subjectbox"]'],
    bodyField: ['div[aria-label="Message Body"][role="textbox"]', 'div[g_editable="true"][role="textbox"]'],
    sendButton: ['div[role="button"][data-tooltip^="Send"]'],
  };

  // BEST-GUESS PLACEHOLDERS — see file header. Ordered most- to
  // least-specific; the first one that matches a real element wins.
  const MAILSUITE = {
    icon: [
      '[aria-label*="Mailsuite" i]',
      '[data-tooltip*="Mailsuite" i]',
      '[title*="Mailsuite" i]',
      'img[src*="mailsuite" i]',
    ],
    templateDropdown: [
      '[role="listbox"][aria-label*="template" i]',
      '[role="menu"][aria-label*="Mailsuite" i]',
      '.mailsuite-template-list',
    ],
    templateItem: ['[role="option"]', '[role="menuitem"]'],
  };

  const SENT_TOAST_TEXT = /message sent/i;

  /**
   * Returns the first element in `root` matching any selector in `selectors`,
   * tried in order — a plain-CSS stand-in for Playwright's comma-joined
   * selector fallback lists in src/gmail-selectors.js.
   * @param {Element | Document} root
   * @param {string[]} selectors
   * @returns {Element | null}
   */
  function queryAny(root, selectors) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * Finds the first visible element under `root` whose text content matches
   * `pattern` — the DOM equivalent of Playwright's `:has-text()`/`text=`
   * pseudo-selectors used in src/gmail-selectors.js, which have no native
   * `document.querySelector` equivalent.
   * @param {Element | Document} root
   * @param {string} cssSelector - narrows candidates before text-matching.
   * @param {RegExp} pattern
   * @returns {Element | null}
   */
  function findByText(root, cssSelector, pattern) {
    const candidates = root.querySelectorAll(cssSelector);
    for (const el of candidates) {
      if (pattern.test(el.textContent ?? '')) return el;
    }
    return null;
  }

  /**
   * Polls (via MutationObserver, not a fixed timeout) until `check()`
   * returns a truthy value, then resolves with it. Rejects with a specific,
   * named error if `timeoutMs` elapses first — mirrors the old
   * automation.js's approach of throwing an error that names exactly which
   * selector/condition never appeared, instead of a generic timeout.
   * @param {() => any} check - returns a truthy value (e.g. an Element) when the condition is met.
   * @param {{timeoutMs?: number, description: string, target?: Node}} options - `target`
   *   scopes the MutationObserver (default `document.body`); scope it to the
   *   smallest relevant subtree (e.g. the compose body field) when possible,
   *   both for efficiency and so unrelated page mutations can't spuriously
   *   re-trigger the check.
   * @returns {Promise<any>}
   */
  function waitFor(check, { timeoutMs = 15000, description, target = document.body }) {
    return new Promise((resolve, reject) => {
      const immediate = check();
      if (immediate) {
        resolve(immediate);
        return;
      }

      const observer = new MutationObserver(() => {
        const result = check();
        if (result) {
          cleanup();
          resolve(result);
        }
      });

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for: ${description}`));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        observer.disconnect();
      }

      observer.observe(target, { childList: true, subtree: true, characterData: true });
    });
  }

  /**
   * Dispatches a realistic pointer/mouse event sequence, not just a bare
   * `.click()`. Gmail's compose UI is a closure-compiled app, not React, but
   * some of its widgets (and Mailsuite's, being an unknown third party) may
   * bind to pointerdown/mousedown rather than relying solely on the
   * synthetic `click` event `.click()` produces — investigate and adjust
   * here first if a click silently doesn't register during real testing.
   * @param {Element} el
   */
  function simulateClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  /**
   * Sets a contenteditable/input element's content and fires the events a
   * real typing session would, so Gmail's/Mailsuite's own JS (which listens
   * for `input`, not just reads `.value`/`.textContent` once) notices the
   * change.
   * @param {Element} el
   * @param {string} text
   */
  function setEditableContent(el, text) {
    el.focus();
    if ('value' in el) {
      el.value = text;
    } else {
      el.textContent = text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Replaces every occurrence of each `replacements` key with its value,
   * across all text nodes under `el`, in place — preserving whatever HTML
   * structure/formatting Mailsuite's template inserted (bold, links, line
   * breaks). Deliberately does NOT read/rewrite `el.innerHTML` or
   * `el.textContent` wholesale: doing so would flatten rich formatting to
   * plain text, which a naive personalization pass could easily do by
   * accident. Fires one `input` event afterward so Gmail notices the body
   * changed (matches real typing behavior: one logical edit, one event).
   * @param {Element} el
   * @param {Record<string, string>} replacements - e.g. { "[First Name]": "Alice" }
   * @returns {number} total number of replacements made, across all text nodes.
   */
  function replaceTextInElement(el, replacements) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let replacedCount = 0;
    let node = walker.nextNode();

    while (node) {
      let { nodeValue } = node;
      for (const [placeholder, value] of Object.entries(replacements)) {
        if (!placeholder) continue;
        const before = nodeValue;
        nodeValue = nodeValue.split(placeholder).join(value);
        if (nodeValue !== before) {
          replacedCount += before.split(placeholder).length - 1;
        }
      }
      if (nodeValue !== node.nodeValue) {
        node.nodeValue = nodeValue;
      }
      node = walker.nextNode();
    }

    if (replacedCount > 0) {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    }
    return replacedCount;
  }

  window.__prospectReachGmailDom = {
    GMAIL,
    MAILSUITE,
    SENT_TOAST_TEXT,
    queryAny,
    findByText,
    waitFor,
    simulateClick,
    setEditableContent,
    replaceTextInElement,
  };
})();
