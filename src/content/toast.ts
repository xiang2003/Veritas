const HIDE_AFTER_MS = 4000;

/** Small transient notice in the page corner (e.g. "API key missing"). */
export function showToast(doc: Document, message: string): void {
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    div { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 280px; padding: 10px 14px;
      background: #1f2430; color: #fff; border-radius: 8px; font: 13px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  </style><div></div>`;
  shadow.querySelector('div')!.textContent = `Veritas: ${message}`;
  doc.body.append(host);
  setTimeout(() => host.remove(), HIDE_AFTER_MS);
}
