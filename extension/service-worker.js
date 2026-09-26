// No installed content script and no inspection until a toolbar click.
// Session storage survives service-worker suspension, but clears on browser exit.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.storage.session.set({ invocation: { tabId: tab.id, at: Date.now() } });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
