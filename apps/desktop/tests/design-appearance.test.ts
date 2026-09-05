// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { syncSystemAppearance } from '../src/renderer/design-system/appearance';

afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.mode; });

it('keeps Kumo controls in the system appearance and releases its listener', () => {
  let changed: () => void = () => undefined;
  const preference = {
    matches: true,
    addEventListener: vi.fn((_event: string, listener: () => void) => { changed = listener; }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => preference));
  const stop = syncSystemAppearance();
  expect(document.documentElement.dataset.mode).toBe('dark');
  preference.matches = false;
  changed();
  expect(document.documentElement.dataset.mode).toBe('light');
  stop();
  expect(preference.removeEventListener).toHaveBeenCalledWith('change', changed);
});
