import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetPath = fileURLToPath(new URL('../src/renderer/app.css', import.meta.url));

describe('renderer theme', () => {
  it('leaves Kumo semantic tokens at their library defaults', async () => {
    const css = await readFile(stylesheetPath, 'utf8');

    expect(css).not.toMatch(/--[\w-]*kumo[\w-]*\s*:/);
  });

  it('does not replace the visual chrome of Kumo controls', async () => {
    const css = await readFile(stylesheetPath, 'utf8');

    expect(css).not.toMatch(/\.settings-form\s+(?:button|input)/);
    expect(css).not.toMatch(/\.primary-action\s*\{/);
    expect(css).not.toMatch(/\[role=["']dialog["']\]\s*\{/);
    expect(css).not.toContain('!important');
  });

  it('does not replace Kumo focus or color-scheme behavior', async () => {
    const css = await readFile(stylesheetPath, 'utf8');

    expect(css).not.toMatch(/(?:button|input|\[role=["']combobox["']\]).*:focus-visible/);
    expect(css).not.toMatch(/color-scheme:\s*(?:light|dark)\s*;/);
  });
});
