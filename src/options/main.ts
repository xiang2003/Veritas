import { createSettings } from '../lib/settings.ts';
import { fillForm, readForm } from './form.ts';

const settings = createSettings(chrome.storage.local);
const form = document.querySelector<HTMLFormElement>('#settings')!;
const status = document.querySelector<HTMLElement>('#status')!;

function say(message: string): void {
  status.textContent = message;
}

settings.get().then((s) => fillForm(form, s));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  // Drop undefined entries so blank optional fields keep their stored/default values.
  const patch = Object.fromEntries(Object.entries(readForm(form)).filter(([, v]) => v !== undefined));
  await settings.set(patch);
  say('Saved ✓');
});

document.querySelector('#grant-mic')!.addEventListener('click', async () => {
  try {
    // Prompting from an extension page grants the permission to the side panel too.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    say('Microphone enabled ✓');
  } catch {
    say('Microphone permission was denied. Allow it in chrome://settings/content/microphone.');
  }
});
