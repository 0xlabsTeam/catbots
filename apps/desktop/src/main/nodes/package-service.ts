import { ChatFlowStore } from './chat-flow-store';
import { FlowJournal } from './flow-journal';
import { randomUUID } from 'node:crypto';
import { createPackageExample, exampleContext } from '@catbots/strategy-runtime';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodePackageCommandSchema, type InstalledNodePackage, type NodePackageStatus } from '@catbots/contracts';
import { CommunityNodeCatalog, listRuntimePackages, serializeCanonicalJson, validateNodePackage, type JsonValue } from '@catbots/strategy-runtime';
export class NodePackageService {
  private packages: InstalledNodePackage[];
  constructor(private path: string) {
    this.packages = [];
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8'); if (text.length > 10000000) throw new Error('Node package storage too large');
      const entries: unknown = JSON.parse(text); if (!Array.isArray(entries) || entries.length > 64) throw new Error('Invalid node package storage');
      this.packages = entries.map((entry) => { const manifest = validateNodePackage(entry.manifest); const integrity = digest(manifest); if (entry.integrity !== integrity || typeof entry.enabled !== 'boolean') throw new Error('Package integrity mismatch'); return { manifest, integrity, enabled: entry.enabled }; });
      this.catalog();
    }
  }
  flowStore() { return new ChatFlowStore(`${this.path}.chat-flows.json`); }
  catalog() { return new CommunityNodeCatalog(this.packages); }
  command(input: unknown): NodePackageStatus {
    const command = NodePackageCommandSchema.parse(input);
    if (command.action === 'edit_flow') return { packages: [], flowDraft: this.flowStore().edit(command.botId, command.edit) };
    if (command.action === 'market_snapshot') throw new Error('Use asynchronous market handler');
    if (command.action === 'list') return { packages: structuredClone(this.packages), runtimePackages: listRuntimePackages() };
    if (command.action === 'simulate') {
      const journal = new FlowJournal(`${this.path}.simulations.json`);
      const runId = randomUUID();
      const document = createPackageExample(command.example);
      const prices = command.example === 'dca' ? [100,100,94,94,99,99] : [100,100,100,100,102,102];
      let previous: ReturnType<FlowJournal['evaluate']> | undefined;
      const pending = new Map<string, NonNullable<typeof previous>['orders'][number]>();
      const steps = prices.map((price,index) => {
        const context = exampleContext(runId,index,price);
        // Demonstrates acknowledgement on the next step, explicitly using synthetic fills.
        for (const order of previous?.orders ?? []) pending.set(order.clientOrderId, order);
        for (const id of previous?.cancelOrderIds ?? []) pending.delete(id);
        context.fills = [...pending.values()].filter(order => order.limitPrice === undefined || (order.side === 'buy' ? price <= order.limitPrice : price >= order.limitPrice)).map(order => ({ id: `${order.clientOrderId}:fill`, clientOrderId: order.clientOrderId, side: order.side, quantity: order.quantity, price: order.limitPrice ?? price, fee: 0 }));
        for (const fill of context.fills) pending.delete(fill.clientOrderId);
        context.cancelledOrderIds = previous?.cancelOrderIds ?? [];
        previous = journal.evaluate(document,context);
        return { price, proposed: previous.orders.length, cancellations: previous.cancelOrderIds.length, state: previous.trace.find(item => item.nodeId === 'strategy')?.outputs.status.value, outputs: Object.fromEntries(previous.trace.map(item => [item.nodeId,item.outputs])) };
      });
      return { packages: structuredClone(this.packages), runtimePackages: listRuntimePackages(), simulation: { example: command.example, runId, steps } };
    }
    let next = structuredClone(this.packages);
    if (command.action === 'install') {
      const manifest = validateNodePackage(JSON.parse(command.source)); const integrity = digest(manifest);
      if (next.some((item) => item.manifest.name === manifest.name && item.manifest.version === manifest.version && item.integrity !== integrity)) throw new Error('Published version has different contents');
      next = next.map((item) => item.manifest.name === manifest.name ? { ...item, enabled: false } : item);
      const existing = next.find((item) => item.integrity === integrity);
      if (existing) existing.enabled = true; else { if (next.length >= 64) throw new Error('Package archive limit reached'); next.push({ manifest, integrity, enabled: true }); }
    } else {
      const item = next.find((item) => item.integrity === command.integrity); if (!item) throw new Error('Package not found');
      if (command.enabled) next.forEach((other) => { if (other.manifest.name === item.manifest.name) other.enabled = false; });
      item.enabled = command.enabled;
    }
    new CommunityNodeCatalog(next);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(next), { mode: 0o600 }); renameSync(`${this.path}.tmp`, this.path); this.packages = next;
    return { packages: structuredClone(this.packages), runtimePackages: listRuntimePackages() };
  }
}
function digest(value: unknown) { return `sha256:${createHash('sha256').update(serializeCanonicalJson(value as JsonValue)).digest('hex')}`; }
