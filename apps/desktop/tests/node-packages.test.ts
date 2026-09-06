import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { exampleNodePackage } from '@catbots/contracts';
import { NodePackageService } from '../src/main/nodes/package-service';
const dirs: string[] = []; afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
it('installs, retains immutable versions, rolls back and restores the catalog after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catbots-nodes-')); dirs.push(dir); const path = join(dir, 'packages.json');
  const service = new NodePackageService(path);
  const installed = service.command({ action: 'install', source: JSON.stringify(exampleNodePackage) });
  const first = installed.packages[0]!;
  const modified = structuredClone(exampleNodePackage); modified.nodes[0]!.title = 'Changed';
  expect(() => service.command({ action: 'install', source: JSON.stringify(modified) })).toThrow('different contents');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1);
  modified.version = '1.1.0'; service.command({ action: 'install', source: JSON.stringify(modified) });
  const restored = new NodePackageService(path);
  expect(restored.command({ action: 'list' }).packages.map((item) => item.enabled)).toEqual([false, true]);
  restored.command({ action: 'enable', integrity: first.integrity, enabled: true });
  expect(restored.catalog().registry.get('condition', 'catbots.funding_filter', 1).visualization.title).toBe('Funding filter');
});

it('persists research markets per bot without editing workflow documents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catbots-market-')); dirs.push(dir);
  const path = join(dir, 'packages.json');
  const service = new NodePackageService(path);
  const botId = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  service.command({ action: 'save_workspace_market', botId, market: 'SOL-PERP' });
  const restored = new NodePackageService(path);
  expect(restored.command({ action: 'get_workspace_market', botId }).workspaceMarket).toBe('SOL-PERP');
  expect(restored.command({ action: 'get_workspace_market', botId: other }).workspaceMarket).toBeUndefined();
  expect(restored.flowStore().get(botId)).toBeUndefined();
  expect(() => restored.command({ action: 'save_workspace_market', botId, market: 'bad market' })).toThrow();
});
