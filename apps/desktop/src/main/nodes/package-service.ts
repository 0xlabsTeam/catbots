import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodePackageCommandSchema, type InstalledNodePackage, type NodePackageStatus } from '@catbots/contracts';
import { CommunityNodeCatalog, serializeCanonicalJson, validateNodePackage, type JsonValue } from '@catbots/strategy-runtime';
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
  catalog() { return new CommunityNodeCatalog(this.packages); }
  command(input: unknown): NodePackageStatus {
    const command = NodePackageCommandSchema.parse(input);
    if (command.action === 'list') return { packages: structuredClone(this.packages) };
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
    return { packages: structuredClone(this.packages) };
  }
}
function digest(value: unknown) { return `sha256:${createHash('sha256').update(serializeCanonicalJson(value as JsonValue)).digest('hex')}`; }
