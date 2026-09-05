import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [name, directory] = process.argv.slice(2);
if (!name || !/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(name) || !directory) throw new Error('Usage: node scripts/create-node-package.mjs @publisher/package output-directory');
const scope = name.split('/')[0].slice(1).replaceAll('-', '_');
const manifest = {
  format: 'catbots-subflow', sdkVersion: 1, name, version: '1.0.0', license: 'UNLICENSED',
  nodes: [{ type: `${scope}.funding_filter`, version: 1, kind: 'condition', title: 'Funding filter', description: 'Match funding below a threshold.',
    fields: { threshold: { type: 'number', label: 'Funding threshold', default: 0, minimum: -1, maximum: 1 } },
    nodes: [{ id: 'compare', kind: 'condition', type: 'predicate.compare', version: 1, config: { left: { ref: 'market.funding', field: 'rate' }, operator: 'lt', right: { literal: { $param: 'threshold' } } } }],
    edges: [], inputs: [{ id: 'activation', dataType: 'activation', targets: [{ node: 'compare', port: 'activation' }] }], outputs: [{ id: 'result', dataType: 'condition', source: { node: 'compare', port: 'result' } }],
  }],
};
const output = resolve(directory); await mkdir(output, { recursive: true });
await writeFile(join(output, 'node-package.catbots.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log('Created node-package.catbots.json. Choose a license, validate with @catbots/node-sdk, then install the JSON from Catbots Nodes.');
