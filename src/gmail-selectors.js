/**
 * Every Gmail DOM selector the automation layer touches, in one place.
 *
 * Gmail's class names are obfuscated and change often; aria-label,
 * data-tooltip, and visible-text selectors are more stable and are
 * preferred here wherever Gmail exposes one. If a flow in automation.js
 * starts timing out, this is the first (and ideally only) file to check:
 * open Gmail, inspect the relevant element, and update its entry below.
 *
 * Verified against the Gmail web UI as of 2026-08. Gmail ships UI changes
 * without notice — treat every selector here as provisional.
 */
export const selectors = {
  // Inbox chrome
  composeButton: 'div[role="button"][gh="cm"], div[role="button"]:has-text("Compose")',

  // Compose window
  composeDialog: 'div[role="dialog"]',
  toField: 'textarea[name="to"], input[aria-label^="To"]',
  subjectField: 'input[name="subjectbox"]',
  bodyField: 'div[aria-label="Message Body"][role="textbox"]',

  // Send-now
  sendButton: 'div[role="button"][data-tooltip^="Send"]',
  sentToast: 'text=Message sent',

  // Schedule send
  sendDropdownArrow: 'div[aria-label="More send options"]',
  scheduleSendMenuItem: 'div[role="menuitem"]:has-text("Schedule send")',
  scheduleSendDialog: 'div[role="dialog"]:has-text("Schedule send")',
  scheduleDateInput: 'input[aria-label="Date"]',
  scheduleTimeInput: 'input[aria-label="Time"]',
  scheduleSendConfirmButton: 'div[role="button"]:has-text("Schedule send")',
  scheduledToast: 'text=/scheduled to send/i',
};
