import { createGeminiClient } from '../lib/gemini.ts';
import { articleKey } from '../lib/messages.ts';
import { createSettings, DEFAULT_SETTINGS, type Settings } from '../lib/settings.ts';
import { createRecorder } from '../lib/recorder.ts';
import { createTts } from '../lib/speech.ts';
import { createTutorSession } from '../lib/tutor.ts';
import type { ArticleData } from '../lib/types.ts';
import { createController } from './controller.ts';
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

const controller = createController({
  // Level/language are read when a session is created (refresh() loads the latest settings first).
  createSession: (article) => createTutorSession(client, article, latestSettings),
  recorder: createRecorder(),
  tts: createTts({ synth: speechSynthesis, createUtterance: (t) => new SpeechSynthesisUtterance(t) }),
  view,
  getRate: () => rate,
});
replay = (text) => void controller.replay(text);

async function loadActiveArticle(): Promise<ArticleData | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return null;
  const key = articleKey(tab.id);
  return ((await chrome.storage.session.get(key))[key] as ArticleData | undefined) ?? null;
}

async function refresh(): Promise<void> {
  latestSettings = await settings.get();
  rate = latestSettings.speechRate;
  const article = await loadActiveArticle();
  if (article?.url === currentUrl) return; // same article: keep the conversation going
  currentUrl = article?.url;
  controller.setArticle(article);
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

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, change) => change.status === 'complete' && void refresh());
chrome.storage.session.onChanged.addListener(() => void refresh());
void refresh();
