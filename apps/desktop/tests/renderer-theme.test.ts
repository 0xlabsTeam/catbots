import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetPath = fileURLToPath(new URL('../src/renderer/app.css', import.meta.url));

describe('renderer theme', () => {
  it('keeps authored color values behind named design tokens', async () => {
    const css = await readFile(stylesheetPath, 'utf8');
    const nonTokenColorLiterals = css.split('\n').flatMap((line, lineIndex) => {
      const withoutTokenDeclarations = line.replace(/--[\w-]+\s*:[^;]+;/g, '');
      return /#[\da-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i.test(withoutTokenDeclarations)
        ? [lineIndex + 1]
        : [];
    });

    expect(nonTokenColorLiterals, `color literals outside token declarations on lines ${nonTokenColorLiterals.join(', ')}`).toEqual([]);
    expect(css).toMatch(/\.unavailable-metric\s*\{[^}]*color:\s*var\(--color-metric-unavailable\)/s);
  });

  it('provides AA text contrast in light and dark color schemes', async () => {
    const css = await readFile(stylesheetPath, 'utf8');
    const light = parseTokens(extractBlock(css, ':root'));
    const darkMedia = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/);

    expect(darkMedia, 'dark color-scheme media query').not.toBeNull();
    const dark = { ...light, ...parseTokens(extractBlock(darkMedia?.[1] ?? '', ':root')) };

    for (const [scheme, tokens] of [['light', light], ['dark', dark]] as const) {
      expect(contrast(tokens['--color-primary-text'], tokens['--color-primary-bg']), `${scheme} primary button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['--color-metric-unavailable'], tokens['--color-surface']), `${scheme} unavailable metrics`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['--color-text-muted'], tokens['--color-surface']), `${scheme} muted copy`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('retains keyboard focus and reduced-motion accessibility affordances', async () => {
    const css = await readFile(stylesheetPath, 'utf8');

    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*[^;]*var\(--color-focus\)/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});

function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing ${selector} block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) throw new Error(`Malformed ${selector} block`);
  return css.slice(open + 1, close);
}

function parseTokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map((match) => [match[1]!, match[2]!]));
}

function contrast(foreground: string | undefined, background: string | undefined): number {
  if (foreground === undefined || background === undefined) throw new Error('Missing required contrast token');
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red!) + (0.7152 * green!) + (0.0722 * blue!);
}
