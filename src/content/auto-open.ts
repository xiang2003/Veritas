import { UI_CLASS } from './paragraphs.ts';

const HINT_MS = 5000;
const LABEL = '💬 AI 教練';

/**
 * Floating "💬 AI 教練" button on news articles (like the front page's recommendation button).
 * Chrome only opens the side panel in response to a user gesture, and a click on this button is one.
 * `open` resolves to whether the panel opened.
 */
export function showTutorButton(doc: Document, open: () => Promise<boolean>): HTMLElement {
  const host = doc.createElement('div');
  host.className = UI_CLASS;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    button { all: unset; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; cursor: pointer;
      padding: 10px 16px; border-radius: 999px; background: #4f46e5; color: #fff;
      font: 600 14px/1.4 system-ui, "Noto Sans TC", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
    button:focus-visible { outline: 3px solid #a5b4fc; }
  </style><button type="button"></button>`;
  const button = shadow.querySelector('button')!;
  button.textContent = LABEL;
  button.title = '打開 AI 教練側欄';

  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener('click', async () => {
    if (await open().catch(() => false)) return;
    // Chrome refused: point to the toolbar icon, which always works.
    button.textContent = '請點瀏覽器右上角的 Veritas 圖示';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (button.textContent = LABEL), HINT_MS);
  });
  doc.body.append(host);
  return host;
}
