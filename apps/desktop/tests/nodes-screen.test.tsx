// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { exampleNodePackage, type NodePackageCommand } from '@catbots/contracts';
import { NodesScreen } from '../src/renderer/screens/NodesScreen';
afterEach(cleanup);
it('installs the starter through the API and renders schema fields with enable/disable controls', async () => {
  const command = vi.fn(async (input: NodePackageCommand) => ({ packages: input.action === 'install' ? [{ manifest: exampleNodePackage, integrity: `sha256:${'a'.repeat(64)}`, enabled: true }] : [] }));
  render(<NodesScreen api={{ command }} />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Install Funding Filter' }));
  expect(await screen.findByRole('spinbutton', { name: 'Funding threshold' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Disable for new drafts' })).toBeTruthy();
  expect(command).toHaveBeenCalledWith({ action: 'install', source: JSON.stringify(exampleNodePackage) });
});
