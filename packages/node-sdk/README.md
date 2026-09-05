# Catbots node SDK

Two contracts currently coexist:

- **Community JSON v1**: portable declarative subflows installed from the Nodes screen. See [community authoring](../../docs/architecture/community-node-sdk.md).
- **Runtime v3**: typed executable definitions assembled as workspace packages. Currently available only in local simulation; the UI does not install executable JavaScript packages.

## Write a runtime definition

```ts
import { z } from 'zod';
import { definePackage, ready, unavailable } from '@catbots/node-sdk';

export const myPackage = definePackage('@myteam/nodes-math', [{
  type: 'myteam.scale',
  version: 1,
  category: 'process',
  title: 'Scale value',
  config: z.object({ factor: z.number().finite() }).strict(),
  inputs: { value: 'number' },
  outputs: { value: 'number' },
  evaluate(input, config) {
    if (input.value.quality !== 'ready') {
      return { outputs: { value: unavailable('number', input.value.reason ?? 'Input unavailable') } };
    }
    const value = Number(input.value.value) * config.factor;
    return { outputs: { value: Number.isFinite(value)
      ? ready('number', value)
      : unavailable('number', 'Result exceeds number range') } };
  },
}]);
```

Use a unique namespaced type and increment its definition version when changing its contract. Register a workspace package in `packages/strategy-runtime/src/node-packages.ts`. Package manifests currently use version `0.1.0`; the helper is intended for these local packages, not a public registry release workflow.

Evaluation must be deterministic: use the supplied context time/data, return new state, and never read credentials, call an exchange or perform filesystem/network effects. Only action/strategy categories may return order or cancellation proposals. The host owns persistence and execution. The in-process evaluator isolates data copies, but is **not a sandbox for untrusted executable code**.

Add tests for unavailable data, invalid configuration, finite output, state replay and market isolation. Strategy tests also need partial fills, duplicate fills, cancellation acknowledgement, order limits and restart replay.

See [architecture and current limitations](../../docs/architecture/2026-09-06-trader-node-packages.md).
