/** Class on every element Veritas inserts into the page, so other passes (e.g. highlighting) can skip them. */
export const UI_CLASS = 'veritas-ui';
export const TOOLS_CLASS = 'veritas-tools';
export const BUTTON_CLASS = 'veritas-btn';
export const PANEL_CLASS = 'veritas-tr-panel';

const MIN_CHARS = 40; // skip captions, bylines and other short lines

export interface ParagraphToolsDeps {
  translate: (text: string) => Promise<string>;
  /** Resolves when playback finishes or is interrupted. */
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text = '') {
  const el = doc.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function toolButton(doc: Document, label: string, title: string): HTMLButtonElement {
  const button = node(doc, 'button', `${UI_CLASS} ${BUTTON_CLASS}`, label);
  button.type = 'button';
  button.title = title;
  return button;
}

/**
 * Per-paragraph tools shown at the paragraph's right: 🔊 read aloud and 譯 translate.
 * One instance shares playback state so only one paragraph is read at a time.
 */
export function createParagraphTools({ translate, speak, stop }: ParagraphToolsDeps) {
  let playing: HTMLButtonElement | undefined;

  function setPlaying(button: HTMLButtonElement | undefined) {
    if (playing) {
      playing.classList.remove('open');
      playing.textContent = '🔊';
    }
    playing = button;
    if (button) {
      button.classList.add('open');
      button.textContent = '⏹';
    }
  }

  function wireSpeak(button: HTMLButtonElement, text: string) {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (playing === button) {
        stop();
        return setPlaying(undefined);
      }
      setPlaying(button);
      try {
        await speak(text);
      } finally {
        if (playing === button) setPlaying(undefined); // finished by itself (not replaced by another paragraph)
      }
    });
  }

  function wireTranslate(button: HTMLButtonElement, p: HTMLElement, text: string) {
    let panel: HTMLElement | undefined;
    let loaded = false;
    let loading = false;

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation(); // the paragraph may sit inside a link on some sites
      if (panel && loaded) {
        panel.hidden = !panel.hidden;
        button.classList.toggle('open', !panel.hidden);
        return;
      }
      if (loading) return;
      if (!panel) {
        panel = node(p.ownerDocument, 'div', `${UI_CLASS} ${PANEL_CLASS}`);
        p.after(panel);
      }
      panel.hidden = false;
      panel.textContent = '翻譯中…';
      button.classList.add('open');
      loading = true;
      try {
        panel.textContent = await translate(text);
        loaded = true;
      } catch (error) {
        panel.textContent = `⚠ ${error instanceof Error ? error.message : String(error)}（再點一次重試）`;
      } finally {
        loading = false;
      }
    });
  }

  return {
    /**
     * Add the tools to every long paragraph under `root`. Safe to call repeatedly.
     * @returns number of paragraphs that received tools
     */
    attach(root: Element): number {
      let added = 0;
      for (const p of root.querySelectorAll<HTMLElement>('p')) {
        if (p.closest(`.${UI_CLASS}`) || p.querySelector(`:scope > .${TOOLS_CLASS}`)) continue;
        const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < MIN_CHARS) continue;

        const doc = p.ownerDocument;
        const speakButton = toolButton(doc, '🔊', '朗讀 / Read aloud');
        const translateButton = toolButton(doc, '譯', '查看翻譯 / Translate');
        wireSpeak(speakButton, text);
        wireTranslate(translateButton, p, text);

        const tools = node(doc, 'span', `${UI_CLASS} ${TOOLS_CLASS}`);
        tools.append(speakButton, translateButton);
        p.prepend(tools);
        added++;
      }
      return added;
    },
  };
}
