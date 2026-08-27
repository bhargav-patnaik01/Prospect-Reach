/**
 * Minimal service worker — exists only to wire the toolbar icon to open the
 * side panel. No batch orchestration lives here yet (that's a later sprint,
 * once there's a content script/Gmail automation for it to orchestrate).
 */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior:', error));
