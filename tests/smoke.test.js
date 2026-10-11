import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manifest is MV3 and declares required entry points', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.background.service_worker);
  assert.ok(m.side_panel.default_path);
  assert.ok(m.content_scripts[0].js.length);
});
