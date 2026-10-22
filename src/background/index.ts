import { createGeminiClient } from '../lib/gemini.ts';
import type { OpenPanelMessage } from '../lib/messages.ts';
import { isNewsUrl } from '../lib/site-match.ts';
import { createSettings } from '../lib/settings.ts';
import { createHandlers } from './handlers.ts';

const settings = createSettings(chrome.storage.local);
const handlers = createHandlers({
  client: createGeminiClient({ getSettings: settings.get }),
  getSettings: settings.get,
  cache: chrome.storage.local,
  session: chrome.storage.session,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as OpenPanelMessage)?.type === 'open-panel') {
    // Must be called synchronously here, while Chrome still treats it as the page's user gesture.
    chrome.sidePanel.open({ windowId: sender.tab!.windowId }).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: String(error) }),
    );
    return true;
  }
  const pending = handlers.handle(message, sender.tab?.id);
  if (!pending) return false;
  pending.then(sendResponse);
  return true; // keep the channel open for the async response
});

// Clicking the toolbar icon opens the tutor side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// First run: send the user to the options page to enter their Gemini API key.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`article:${tabId}`);
});

// The panel belongs to news sites only: Chrome hides it on tabs where it is disabled and shows it
// again on news tabs, where each article keeps its own conversation.
const NEWS_SITES = chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.matches ?? []) ?? [];

function syncPanel(tabId: number, url: string | undefined): void {
  if (!url) return; // URL not known yet; a later update will carry it
  // As in Chrome's site-specific side panel sample: an enabled tab must also name the panel page,
  // otherwise clicking the toolbar icon may open nothing.
  const options = isNewsUrl(url, NEWS_SITES) ? { tabId, path: 'sidepanel.html', enabled: true } : { tabId, enabled: false };
  chrome.sidePanel.setOptions(options).catch(console.error);
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading') syncPanel(tabId, tab.url);
});
chrome.tabs.query({}).then((tabs) => tabs.forEach((t) => t.id !== undefined && syncPanel(t.id, t.url)));
