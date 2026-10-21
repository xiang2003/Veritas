import { createGeminiClient } from '../lib/gemini.ts';
import { articleKey, type ActivateMessage } from '../lib/messages.ts';
import { createSettings, DEFAULT_SETTINGS, type Settings } from '../lib/settings.ts';
import { createRecorder } from '../lib/recorder.ts';
import { createTts } from '../lib/speech.ts';
import { createTutorSession } from '../lib/tutor.ts';
import type { ArticleData } from '../lib/types.ts';
import { createController, type ConversationStore, type SavedConversation } from './controller.ts';
import { createView } from './view.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const settings = createSettings(chrome.storage.local);
const client = createGeminiClient({ getSettings: settings.get });

let latestSettings: Settings = DEFAULT_SETTINGS;
let currentUrl: string | undefined;
let rate = 1;
let replay: (text: string) => void = () => {};

const view = createView(
  document,
  {
    title: $('#title'), status: $('#status'), log: $('#log'), error: $('#error'),
    startButton: $('#start'), micButton: $('#mic'), sendButton: $('#send'), input: $('#text'),
  },
  (text) => replay(text),
);

/** Conversations live in session storage: they survive tab switches and closing the panel, not a browser restart. */
const conversationStore: ConversationStore = {
  async load(url) {
    const key = `conv:${url}`;
    return ((await chrome.storage.session.get(key))[key] as SavedConversation | undefined) ?? null;
  },
  save: (url, conversation) => chrome.storage.session.set({ [`conv:${url}`]: conversation }),
};

const controller = createController({
  // Level/language are read when a session is created (refresh() loads the latest settings first).
  createSession: (article, history) => createTutorSession(client, article, latestSettings, history),
  store: conversationStore,
  recorder: createRecorder(),
  tts: createTts({ synth: speechSynthesis, createUtterance: (t) => new SpeechSynthesisUtterance(t) }),
  view,
  getRate: () => rate,
});
replay = (text) => void controller.replay(text);

/**
 * Each browser window has its own side panel, so the panel follows the active tab of *its* window only.
 * (Following the last-focused window made the conversation vanish when the user switched windows.)
 */
const windowIdPromise = chrome.windows.getCurrent().then((w) => w.id);

async function loadActiveArticle(): Promise<ArticleData | null> {
  const [tab] = await chrome.tabs.query({ active: true, windowId: await windowIdPromise });
  if (tab?.id === undefined) return null;
  // The panel being open is what turns Veritas on for a page. Pages without our content script
  // (other sites, or tabs loaded before the extension) have no receiver – ignore those.
  const activate: ActivateMessage = { type: 'activate' };
  chrome.tabs.sendMessage(tab.id, activate).catch(() => {});
  const key = articleKey(tab.id);
  return ((await chrome.storage.session.get(key))[key] as ArticleData | undefined) ?? null;
}

async function refresh(): Promise<void> {
  latestSettings = await settings.get();
  rate = latestSettings.speechRate;
  const article = await loadActiveArticle();
  if (article?.url === currentUrl) return; // same article: keep the conversation going
  currentUrl = article?.url;
  await controller.setArticle(article);
  if (article && !latestSettings.apiKey) view.showError('Add your Gemini API key in the extension options.');
}

$('#start').addEventListener('click', () => void controller.start());
$('#mic').addEventListener('click', () => controller.toggleMic());
$('#send-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#text');
  void controller.submitText(input.value);
  input.value = '';
});
$('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

const inThisWindow = async (windowId: number) => windowId === (await windowIdPromise);

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  if (await inThisWindow(windowId)) void refresh();
});
chrome.tabs.onUpdated.addListener(async (_id, change, tab) => {
  if (change.status === 'complete' && tab.active && (await inThisWindow(tab.windowId))) void refresh();
});
chrome.storage.session.onChanged.addListener(() => void refresh());
void refresh();
