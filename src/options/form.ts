import type { Settings } from '../lib/settings.ts';

/** Populate the form's controls (matched by `name`) from settings. */
export function fillForm(form: HTMLFormElement, settings: Settings): void {
  for (const [name, value] of Object.entries(settings)) {
    const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (!control) continue;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
  }
}

/** Read the form back into a typed, validated settings patch. */
export function readForm(form: HTMLFormElement): Partial<Settings> {
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const rate = Number(field('speechRate').value);
  return {
    apiKey: field('apiKey').value.trim(),
    nativeLanguage: field('nativeLanguage').value.trim() || undefined,
    level: field('level').value,
    interests: field('interests').value.trim(),
    autoHighlight: field('autoHighlight').checked,
    autoRecommend: field('autoRecommend').checked,
    autoOpen: field('autoOpen').checked,
    speechRate: Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : undefined,
  } as Partial<Settings>;
}
