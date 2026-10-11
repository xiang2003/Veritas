import { createGeminiClient } from '../lib/gemini.ts';
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
