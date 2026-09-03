# Catbots M0 Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable local-first Catbots desktop foundation with secure Electron boundaries, Local Profile onboarding, Settings-managed YAML, embedded SQLite, Bots Home, and a supervised tray runtime skeleton.

**Architecture:** Electron Main owns native lifecycle, configuration, storage, and utility-process supervision. A sandboxed React renderer built with Cloudflare Kumo accesses narrowly scoped capabilities through a typed preload bridge. Local configuration lives in atomically written YAML, durable application records live in SQLite, and no trading or strategy evaluation is implemented in M0.

**Tech Stack:** TypeScript, pnpm workspace, Electron, Electron Forge with Vite, React, Cloudflare Kumo, Zod, YAML, better-sqlite3, Vitest, Testing Library, and Playwright Electron smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-03-catbots-desktop-ui-design.md` and `docs/superpowers/specs/2026-09-03-tca-perp-bot-design.md`

## Global Constraints

- The product is an open-source, local-first desktop application with no cloud account or required Catbots backend.
- The renderer uses React and Cloudflare Kumo; the renderer is sandboxed with `nodeIntegration: false` and `contextIsolation: true`.
- Privileged operations are available only through named, typed preload methods and validated IPC handlers.
- Settings Form is the only in-app writer for `local.env.yaml`; M0 has no raw YAML editor.
- `local.env.yaml` may contain compatible-LLM credentials and a Hyperliquid Agent/API Wallet key. Its strict schema has no master-wallet-key field; M3 Live preflight must verify that the derived signer is an approved Agent wallet before execution.
- Secrets may exist transiently in password inputs and Main-process requests but must not persist in renderer stores, snapshots, logs, diagnostics, exports, or Agent prompts.
- Closing the main window keeps the application alive in the system tray; explicit Quit stops the runtime after confirmation.
- Anonymous telemetry defaults to Off and M0 sends no Catbots telemetry.
- Trading, Backtest, strategy execution, and Hyperliquid network calls are outside M0.
- Use test-driven development and commit after every independently reviewable task.

---

## Planned File Structure

```text
.
├── package.json
├── pnpm-workspace.yaml
├── .npmrc
├── tsconfig.base.json
├── vitest.workspace.ts
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── forge.config.ts
│       ├── vite.main.config.ts
│       ├── vite.preload.config.ts
│       ├── vite.renderer.config.ts
│       ├── assets/trayTemplate.png
│       ├── src/main/main.ts
│       ├── src/main/create-window.ts
│       ├── src/main/register-app-protocol.ts
│       ├── src/main/config/config-schema.ts
│       ├── src/main/config/config-repository.ts
│       ├── src/main/storage/database.ts
│       ├── src/main/storage/migrations.ts
│       ├── src/main/bots/bot-repository.ts
│       ├── src/main/ipc/register-ipc.ts
│       ├── src/main/runtime/runtime-supervisor.ts
│       ├── src/main/runtime/runtime-worker.ts
│       ├── src/main/tray/create-tray.ts
│       ├── src/preload/index.ts
│       ├── src/renderer/index.html
│       ├── src/renderer/global.d.ts
│       ├── src/renderer/main.tsx
│       ├── src/renderer/App.tsx
│       ├── src/renderer/app.css
│       ├── src/renderer/screens/FirstLaunchScreen.tsx
│       ├── src/renderer/screens/SettingsScreen.tsx
│       ├── src/renderer/screens/BotsHomeScreen.tsx
│       └── tests/
│           ├── config-repository.test.ts
│           ├── database.test.ts
│           ├── bot-repository.test.ts
│           ├── ipc-security.test.ts
│           ├── runtime-supervisor.test.ts
│           ├── first-launch.test.tsx
│           ├── settings.test.tsx
│           └── bots-home.test.tsx
├── packages/
│   └── contracts/
│       ├── package.json
│       ├── src/config.ts
│       ├── src/bots.ts
│       ├── src/ipc.ts
│       └── src/index.ts
└── e2e/desktop-smoke.spec.ts
```

Responsibility boundaries:

- `packages/contracts` owns serializable types and Zod schemas shared across process boundaries.
- `src/main/config` owns YAML parsing, validation, atomic persistence, redaction, and permissions.
- `src/main/storage` owns SQLite connection and migrations; feature repositories own queries.
- `src/main/ipc` is the only route from renderer requests to privileged services.
- `src/preload` exposes a small typed API and no generic `send`, filesystem, or process primitive.
- `src/main/runtime` is a lifecycle skeleton only; strategy execution arrives in M1.
- `src/renderer` owns presentation and ephemeral UI state only.

---

### Task 1: Bootstrap the secure Electron workspace

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/forge.config.ts`
- Create: `apps/desktop/vite.main.config.ts`
- Create: `apps/desktop/vite.preload.config.ts`
- Create: `apps/desktop/vite.renderer.config.ts`
- Create: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/src/main/create-window.ts`
- Create: `apps/desktop/src/main/register-app-protocol.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/app.css`
- Create: `apps/desktop/tests/ipc-security.test.ts`

**Interfaces:**

- Produces: `createMainWindow(): BrowserWindow` with secure web preferences.
- Produces: a temporary `window.catbots` bridge containing only `app.getVersion(): Promise<string>` until Task 5 installs the full typed bridge.

- [ ] **Step 1: Create the workspace manifests and install the locked dependency graph**

```json
{
  "name": "catbots",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "dev": "pnpm --filter @catbots/desktop start",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "make": "pnpm --filter @catbots/desktop make"
  }
}
```

Create `pnpm-workspace.yaml` with `apps/*` and `packages/*`, and `.npmrc` with `node-linker=hoisted` as required by Electron Forge's pnpm guidance. Add Electron Forge Vite, React, Kumo, Zod, YAML, better-sqlite3, Vitest, Testing Library, and Playwright dependencies to `apps/desktop/package.json`. Run `pnpm install` so `pnpm-lock.yaml` pins the resolved versions.

- [ ] **Step 2: Write the failing BrowserWindow security test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildWindowOptions } from '../src/main/create-window';

describe('buildWindowOptions', () => {
  it('isolates and sandboxes the renderer', () => {
    const options = buildWindowOptions('/app/preload.js');
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: '/app/preload.js',
    });
  });
});
```

- [ ] **Step 3: Run the security test and confirm the missing export failure**

Run: `pnpm --filter @catbots/desktop test -- ipc-security.test.ts`

Expected: FAIL because `buildWindowOptions` is not exported.

- [ ] **Step 4: Implement the minimal Main, preload, and renderer entry points**

```ts
export function buildWindowOptions(preload: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}
```

In `register-app-protocol.ts`, register the privileged `catbots` scheme before `app.ready`, handle only `catbots://app/*`, normalize the requested path, reject traversal outside the packaged renderer directory, and return packaged files with explicit content types. In `main.ts`, call `app.enableSandbox()` before readiness, load `catbots://app/index.html`, deny unexpected navigation/window creation, and register no remote-content renderer. In preload, expose only a frozen `catbots.app.getVersion` method through `contextBridge`.

- [ ] **Step 5: Verify unit tests, type checking, and a development launch**

Run: `pnpm --filter @catbots/desktop test -- ipc-security.test.ts`

Expected: PASS.

Run: `pnpm typecheck`

Expected: exit 0.

Run: `pnpm dev`

Expected: a local Catbots window renders `Catbots` and DevTools reports no Electron security warning caused by app configuration.

- [ ] **Step 6: Commit the secure shell**

```bash
git add package.json pnpm-workspace.yaml .npmrc tsconfig.base.json vitest.workspace.ts pnpm-lock.yaml apps/desktop
git commit -m "feat: bootstrap secure Electron desktop shell"
```

---

### Task 2: Define shared local-profile, config, bot, and IPC contracts

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/config.ts`
- Create: `packages/contracts/src/bots.ts`
- Create: `packages/contracts/src/ipc.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/config.test.ts`

**Interfaces:**

- Produces: `LocalConfigSchema`, `LocalConfig`, `RedactedLocalConfig`.
- Produces: `BotSummarySchema`, `BotSummary`, `BotStatus`.
- Produces: `CatbotsDesktopApi` with named methods only.

- [ ] **Step 1: Write failing schema tests for valid local config and forbidden master keys**

```ts
import { describe, expect, it } from 'vitest';
import { LocalConfigSchema } from './config';

const valid = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'provider/model',
  },
};

describe('LocalConfigSchema', () => {
  it('accepts a compatible LLM and local profile', () => {
    expect(LocalConfigSchema.parse(valid).profile.telemetry).toBe(false);
  });

  it('rejects a master wallet key anywhere under Hyperliquid config', () => {
    expect(() => LocalConfigSchema.parse({
      ...valid,
      exchanges: { hyperliquid: { masterPrivateKey: '0xdeadbeef' } },
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `pnpm --filter @catbots/contracts test -- config.test.ts`

Expected: FAIL because the schemas are not implemented.

- [ ] **Step 3: Implement strict schemas and serializable API types**

```ts
export const CompatibleProviderUrlSchema = z.string().url().superRefine((value, ctx) => {
  const url = new URL(value);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    ctx.addIssue({ code: 'custom', message: 'Use HTTPS or loopback HTTP' });
  }
});

export const LlmProviderSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('openai-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }).strict(),
  z.object({
    provider: z.literal('anthropic-compatible'),
    baseUrl: CompatibleProviderUrlSchema,
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }).strict(),
]);

export const LocalConfigSchema = z.object({
  profile: z.object({
    name: z.string().trim().min(1).max(80),
    telemetry: z.boolean().default(false),
  }).strict(),
  llm: LlmProviderSchema,
  exchanges: z.object({
    hyperliquid: z.object({
      network: z.enum(['testnet', 'mainnet']),
      accountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      agentPrivateKey: z.string().min(1),
    }).strict().optional(),
  }).strict().default({}),
}).strict();

export type LocalConfig = z.infer<typeof LocalConfigSchema>;
export type RedactedLocalConfig = Omit<LocalConfig, 'llm' | 'exchanges'> & {
  llm: Omit<LocalConfig['llm'], 'apiKey'> & { apiKey: '••••••••' };
  exchanges: {
    hyperliquid?: Omit<NonNullable<LocalConfig['exchanges']['hyperliquid']>, 'agentPrivateKey'> & {
      agentPrivateKey: '••••••••';
    };
  };
};

export const BotStatusSchema = z.enum([
  'draft', 'paper', 'live', 'paused', 'stopped', 'error', 'recovering',
]);
export const CreateDraftBotInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  market: z.string().trim().min(1).max(40),
}).strict();
export const BotSummarySchema = CreateDraftBotInputSchema.extend({
  id: z.string().uuid(),
  status: BotStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BotSummary = z.infer<typeof BotSummarySchema>;

export type RuntimeStatus = {
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';
  activeBots: number;
};
export type BootstrapState =
  | { state: 'first-launch' }
  | { state: 'ready'; config: RedactedLocalConfig }
  | { state: 'repair'; issues: Array<{ path: string; message: string }> };
export type ConnectionTestResult =
  | { ok: true; model: string }
  | { ok: false; code: string; message: string };

export interface CatbotsDesktopApi {
  app: {
    getVersion(): Promise<string>;
    showMainWindow(): Promise<void>;
    quitApplication(): Promise<void>;
  };
  config: {
    getBootstrapState(): Promise<BootstrapState>;
    save(input: unknown): Promise<RedactedLocalConfig>;
    testLlmConnection(input: unknown): Promise<ConnectionTestResult>;
  };
  bots: {
    list(): Promise<BotSummary[]>;
    createDraft(input: unknown): Promise<BotSummary>;
  };
  runtime: {
    getStatus(): Promise<RuntimeStatus>;
    subscribeStatus(listener: (status: RuntimeStatus) => void): () => void;
  };
}
```

Keep the schemas in dependency order as shown. Export inferred `BotStatus` and `CreateDraftBotInput` types alongside the displayed interfaces. Do not expose a generic IPC send method.

- [ ] **Step 4: Run package tests and type checking**

Run: `pnpm --filter @catbots/contracts test && pnpm typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the contracts**

```bash
git add packages/contracts pnpm-lock.yaml package.json pnpm-workspace.yaml
git commit -m "feat: define desktop process contracts"
```

---

### Task 3: Implement atomic YAML configuration persistence

**Files:**

- Create: `apps/desktop/src/main/config/config-repository.ts`
- Create: `apps/desktop/src/main/config/redact-config.ts`
- Create: `apps/desktop/tests/config-repository.test.ts`

**Interfaces:**

- Consumes: `LocalConfigSchema`, `LocalConfig`, `RedactedLocalConfig` from `@catbots/contracts`.
- Produces: `ConfigRepository.load(): Promise<LocalConfig | null>`.
- Produces: `ConfigRepository.save(input: LocalConfig): Promise<RedactedLocalConfig>`.
- Produces: `ConfigRepository.getRedacted(): Promise<RedactedLocalConfig | null>`.

- [ ] **Step 1: Write failing tests for atomic save, permissions, rollback, and redaction**

```ts
const validConfig: LocalConfig = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'provider/model',
  },
  exchanges: {},
};

it('writes valid YAML atomically and returns a redacted view', async () => {
  const repo = new ConfigRepository(tempDir);
  const result = await repo.save(validConfig);
  expect(result.llm.apiKey).toBe('••••••••');
  expect(await readFile(join(tempDir, 'local.env.yaml'), 'utf8')).toContain('api_key: secret');
  expect((await stat(join(tempDir, 'local.env.yaml'))).mode & 0o777).toBe(0o600);
  expect(await readdir(tempDir)).not.toContain('local.env.yaml.tmp');
});

it('keeps the previous valid file when replacement validation fails', async () => {
  const repo = new ConfigRepository(tempDir);
  await repo.save(validConfig);
  await expect(repo.save({
    ...validConfig,
    profile: { ...validConfig.profile, name: '' },
  })).rejects.toThrow();
  expect((await repo.load())?.profile.name).toBe('My Trading');
});
```

- [ ] **Step 2: Run the repository tests and confirm failure**

Run: `pnpm --filter @catbots/desktop test -- config-repository.test.ts`

Expected: FAIL because `ConfigRepository` does not exist.

- [ ] **Step 3: Implement validated load and atomic replacement**

```ts
export class ConfigRepository {
  constructor(private readonly dataDir: string) {}

  async save(input: LocalConfig): Promise<RedactedLocalConfig> {
    const value = LocalConfigSchema.parse(input);
    const target = join(this.dataDir, 'local.env.yaml');
    const temporary = join(this.dataDir, 'local.env.yaml.tmp');
    const previous = join(this.dataDir, 'local.env.yaml.previous');
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(serializeLocalConfig(value), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    parseLocalConfig(await readFile(temporary, 'utf8'));
    if (await fileExists(target)) await copyFile(target, previous);
    await rename(temporary, target);
    await chmod(target, 0o600).catch(ignoreUnsupportedPermissionError);
    return redactLocalConfig(value);
  }
}
```

Define the private helpers in the same module with these exact signatures: `serializeLocalConfig(value: LocalConfig): string`, `parseLocalConfig(source: string): LocalConfig`, `fileExists(path: string): Promise<boolean>`, and `ignoreUnsupportedPermissionError(error: unknown): void`. `serializeLocalConfig` maps `baseUrl`, `apiKey`, `accountAddress`, and `agentPrivateKey` to snake_case YAML keys; `parseLocalConfig` performs the inverse mapping and calls `LocalConfigSchema.parse`. `fileExists` returns false only for `ENOENT`. The permission helper ignores only unsupported Windows permission errors and rethrows every other error. `load` reports a typed `ConfigParseError` with safe field paths and never includes secret values.

- [ ] **Step 4: Run tests and verify no secret appears in snapshots or thrown messages**

Run: `pnpm --filter @catbots/desktop test -- config-repository.test.ts`

Expected: PASS, including a test that serializes all returned errors and finds neither the LLM key nor Agent key.

- [ ] **Step 5: Commit YAML persistence**

```bash
git add apps/desktop/src/main/config apps/desktop/tests/config-repository.test.ts
git commit -m "feat: persist validated local YAML config"
```

---

### Task 4: Add SQLite migrations and the Draft Bot repository

**Files:**

- Create: `apps/desktop/src/main/storage/database.ts`
- Create: `apps/desktop/src/main/storage/migrations.ts`
- Create: `apps/desktop/src/main/bots/bot-repository.ts`
- Create: `apps/desktop/tests/database.test.ts`
- Create: `apps/desktop/tests/bot-repository.test.ts`
- Modify: `apps/desktop/forge.config.ts`
- Modify: `apps/desktop/vite.main.config.ts`

**Interfaces:**

- Produces: `openDatabase(path: string): Database.Database`.
- Produces: `migrateDatabase(db): void` with schema version 1.
- Produces: `BotRepository.createDraft(input): BotSummary` and `BotRepository.list(): BotSummary[]`.

- [ ] **Step 1: Write failing migration and repository tests**

```ts
it('migrates a new database and persists a draft bot', () => {
  const db = openDatabase(':memory:');
  migrateDatabase(db);
  const bots = new BotRepository(db);
  const created = bots.createDraft({ name: 'BTC Flow', market: 'BTC-PERP' });
  expect(created.status).toBe('draft');
  expect(bots.list()).toEqual([created]);
});

it('enables foreign keys and WAL for file databases', () => {
  const db = openDatabase(join(tempDir, 'catbots.db'));
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
});
```

- [ ] **Step 2: Run tests and confirm missing database implementation**

Run: `pnpm --filter @catbots/desktop test -- database.test.ts bot-repository.test.ts`

Expected: FAIL because database functions are not defined.

- [ ] **Step 3: Implement schema version 1 and repository queries**

```sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','paper','live','paused','stopped','error','recovering')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

Define `export type Clock = () => Date` in `bot-repository.ts`. `BotRepository` receives `clock: Clock = () => new Date()` in its constructor, generates IDs with `crypto.randomUUID()`, calls `clock().toISOString()` for timestamps, and maps database rows through `BotSummarySchema` before returning them.

- [ ] **Step 4: Configure native-module packaging**

Add Electron Forge's auto-unpack-natives plugin and keep `better-sqlite3` external to the Main-process Vite bundle so the packaged application loads its native binary from unpacked resources.

- [ ] **Step 5: Run repository tests and package smoke check**

Run: `pnpm --filter @catbots/desktop test -- database.test.ts bot-repository.test.ts`

Expected: PASS.

Run: `pnpm --filter @catbots/desktop package`

Expected: exit 0 and the packaged app opens its SQLite database without a native-module load error.

- [ ] **Step 6: Commit local persistence**

```bash
git add apps/desktop/src/main/storage apps/desktop/src/main/bots apps/desktop/tests apps/desktop/forge.config.ts apps/desktop/vite.main.config.ts
git commit -m "feat: add local bot persistence"
```

---

### Task 5: Register validated IPC and the typed preload bridge

**Files:**

- Create: `apps/desktop/src/main/ipc/register-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/global.d.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Create: `apps/desktop/tests/ipc-security.test.ts`

**Interfaces:**

- Consumes: `ConfigRepository`, `BotRepository`, and request/response schemas from `@catbots/contracts`.
- Produces: the concrete `window.catbots: CatbotsDesktopApi` bridge.

- [ ] **Step 1: Write failing IPC tests for sender validation and malformed payload rejection**

```ts
const localEvent = {
  senderFrame: { url: 'catbots://app/index.html' },
} as unknown as Electron.IpcMainInvokeEvent;
const fakeRemoteEvent = {
  senderFrame: { url: 'https://attacker.example/' },
} as unknown as Electron.IpcMainInvokeEvent;
const validConfig = LocalConfigSchema.parse({
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'provider/model',
  },
});

it('rejects config writes from an unknown sender', async () => {
  const handlers = createIpcHandlers(deps);
  await expect(handlers.saveLocalConfig(fakeRemoteEvent, validConfig))
    .rejects.toThrow('IPC_SENDER_NOT_ALLOWED');
});

it('rejects malformed draft-bot input before repository access', async () => {
  const handlers = createIpcHandlers(deps);
  await expect(handlers.createDraftBot(localEvent, { name: '', market: '' }))
    .rejects.toThrow('INVALID_REQUEST');
  expect(deps.botRepository.createDraft).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the IPC tests and confirm failure**

Run: `pnpm --filter @catbots/desktop test -- ipc-security.test.ts`

Expected: FAIL because handlers are not implemented.

- [ ] **Step 3: Implement one named handler and preload method per capability**

```ts
contextBridge.exposeInMainWorld('catbots', Object.freeze({
  app: { getVersion: () => ipcRenderer.invoke('app:get-version') },
  config: {
    getBootstrapState: () => ipcRenderer.invoke('config:get-bootstrap-state'),
    save: (input: unknown) => ipcRenderer.invoke('config:save', input),
    testLlmConnection: (input: unknown) => ipcRenderer.invoke('config:test-llm', input),
  },
  bots: {
    list: () => ipcRenderer.invoke('bots:list'),
    createDraft: (input: unknown) => ipcRenderer.invoke('bots:create-draft', input),
  },
} satisfies CatbotsDesktopApi));
```

Declare the renderer global in `global.d.ts`:

```ts
import type { CatbotsDesktopApi } from '@catbots/contracts';

declare global {
  interface Window {
    catbots: CatbotsDesktopApi;
  }
}

export {};
```

Validate the sender URL against the packaged application origin and validate every unknown input with the matching Zod schema inside the Main process. Return typed safe errors with stable error codes.

- [ ] **Step 4: Run IPC and contract tests**

Run: `pnpm --filter @catbots/desktop test -- ipc-security.test.ts && pnpm --filter @catbots/contracts test`

Expected: PASS and no preload method exposes `ipcRenderer`, filesystem paths outside the selected data directory, or process primitives.

- [ ] **Step 5: Commit the bridge**

```bash
git add apps/desktop/src/main/ipc apps/desktop/src/main/main.ts apps/desktop/src/preload apps/desktop/src/renderer/global.d.ts apps/desktop/tests/ipc-security.test.ts packages/contracts
git commit -m "feat: expose validated desktop IPC"
```

---

### Task 6: Build First Launch and AI Provider Settings with Kumo

**Files:**

- Create: `apps/desktop/src/renderer/screens/FirstLaunchScreen.tsx`
- Create: `apps/desktop/src/renderer/screens/SettingsScreen.tsx`
- Create: `apps/desktop/src/renderer/components/SecretField.tsx`
- Create: `apps/desktop/src/renderer/components/ConnectionTestStatus.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Create: `apps/desktop/tests/first-launch.test.tsx`
- Create: `apps/desktop/tests/settings.test.tsx`

**Interfaces:**

- Consumes: `window.catbots.config.getBootstrapState`, `.save`, and `.testLlmConnection`.
- Produces: persisted onboarding completion and editable redacted Settings forms.

- [ ] **Step 1: Write failing First Launch behavior tests**

```tsx
const redactedConfig: RedactedLocalConfig = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: '••••••••',
    model: 'provider/model',
  },
  exchanges: {},
};
const api: CatbotsDesktopApi['config'] = {
  getBootstrapState: vi.fn().mockResolvedValue({ state: 'first-launch' }),
  save: vi.fn().mockResolvedValue(redactedConfig),
  testLlmConnection: vi.fn().mockResolvedValue({ ok: true, model: 'provider/model' }),
};

it('requires a successful provider test before completing setup', async () => {
  render(<FirstLaunchScreen api={api} />);
  await user.type(screen.getByLabelText('Profile name'), 'My Trading');
  await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
  await user.type(screen.getByLabelText('API key'), 'secret');
  await user.type(screen.getByLabelText('Model'), 'provider/model');
  expect(screen.getByRole('button', { name: 'Create local profile' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connection successful')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create local profile' })).toBeEnabled();
});
```

- [ ] **Step 2: Run renderer tests and confirm failure**

Run: `pnpm --filter @catbots/desktop test -- first-launch.test.tsx settings.test.tsx`

Expected: FAIL because the screens do not exist.

- [ ] **Step 3: Implement the Calm System onboarding and Settings UI**

Use Kumo form, select, button, callout, progress, dialog, and tooltip primitives. Keep API keys in component-local password-input state, clear them immediately after a successful save, and render only the redacted value returned by Main. Permit HTTPS URLs and loopback HTTP URLs; explain rejection of non-loopback HTTP.

The Settings save sequence is `validate fields → test changed provider → save YAML → clear secret inputs → show saved state`. A malformed existing YAML bootstrap routes directly to Settings repair mode with safe field paths.

- [ ] **Step 4: Run component and accessibility-query tests**

Run: `pnpm --filter @catbots/desktop test -- first-launch.test.tsx settings.test.tsx`

Expected: PASS; every input has a label, errors are associated with fields, and keyboard submission follows the same validation path as clicking.

- [ ] **Step 5: Commit onboarding and Settings**

```bash
git add apps/desktop/src/renderer apps/desktop/tests/first-launch.test.tsx apps/desktop/tests/settings.test.tsx
git commit -m "feat: add local profile and provider setup"
```

---

### Task 7: Build the application shell and Bots Home

**Files:**

- Create: `apps/desktop/src/renderer/components/AppShell.tsx`
- Create: `apps/desktop/src/renderer/components/StatusBadge.tsx`
- Create: `apps/desktop/src/renderer/screens/BotsHomeScreen.tsx`
- Create: `apps/desktop/src/renderer/screens/CreateDraftBotDialog.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Create: `apps/desktop/tests/bots-home.test.tsx`

**Interfaces:**

- Consumes: `window.catbots.bots.list()` and `.createDraft(input)`.
- Produces: global navigation and a local Draft Bot creation flow.

- [ ] **Step 1: Write failing Home and Draft creation tests**

```tsx
const api: CatbotsDesktopApi['bots'] = {
  list: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockImplementation(async (input) => ({
    id: '018f47a2-4a2a-7c5d-9b61-3a83f64406a8',
    ...input,
    status: 'draft',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  })),
};

it('creates a local draft and shows it on Bots Home', async () => {
  render(<BotsHomeScreen api={api} />);
  await user.click(screen.getByRole('button', { name: 'Create new bot' }));
  await user.type(screen.getByLabelText('Bot name'), 'BTC Flow');
  await user.type(screen.getByLabelText('Market'), 'BTC-PERP');
  await user.click(screen.getByRole('button', { name: 'Create draft' }));
  expect(await screen.findByText('BTC Flow')).toBeVisible();
  expect(screen.getByText('Draft')).toBeVisible();
});
```

- [ ] **Step 2: Run the Home test and confirm failure**

Run: `pnpm --filter @catbots/desktop test -- bots-home.test.tsx`

Expected: FAIL because Home components do not exist.

- [ ] **Step 3: Implement global navigation and Bots Home states**

Use the approved sidebar destinations: Bots, Data, Activity, Settings. Implement empty, loading, populated, and safe-error states. Bot rows show name, market, textual status, updated time, and disabled `PnL unavailable`/`Drawdown unavailable` labels until later milestones. `Create new bot` asks only for name and market and persists a Draft through IPC.

- [ ] **Step 4: Run renderer tests and full type check**

Run: `pnpm --filter @catbots/desktop test -- bots-home.test.tsx && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the shell and Home**

```bash
git add apps/desktop/src/renderer apps/desktop/tests/bots-home.test.tsx
git commit -m "feat: add Bots Home and draft creation"
```

---

### Task 8: Add the supervised runtime skeleton and system tray

**Files:**

- Create: `apps/desktop/src/main/runtime/runtime-supervisor.ts`
- Create: `apps/desktop/src/main/runtime/runtime-worker.ts`
- Create: `apps/desktop/src/main/tray/create-tray.ts`
- Create: `apps/desktop/assets/trayTemplate.png`
- Modify: `apps/desktop/src/main/main.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Create: `apps/desktop/tests/runtime-supervisor.test.ts`

**Interfaces:**

- Produces: `RuntimeSupervisor.start(): void`, `.getStatus(): RuntimeStatus`, `.stop(): Promise<void>`.
- Produces: `createTray({ showWindow, quit, getRuntimeStatus }): Tray`.
- Produces: `RuntimeStatus = { state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error'; activeBots: 0 }` in M0.

- [ ] **Step 1: Write failing supervisor state-transition tests**

```ts
function createWorkerDouble(): RuntimeWorkerPort & EventEmitter {
  const worker = new EventEmitter() as RuntimeWorkerPort & EventEmitter;
  worker.postMessage = vi.fn();
  worker.kill = vi.fn().mockReturnValue(true);
  return worker;
}

it('starts one worker and reaches ready', async () => {
  const worker = createWorkerDouble();
  const supervisor = new RuntimeSupervisor(() => worker);
  supervisor.start();
  worker.emit('message', { type: 'ready' });
  expect(supervisor.getStatus()).toEqual({ state: 'ready', activeBots: 0 });
});

it('stops the worker before reporting stopped', async () => {
  const worker = createWorkerDouble();
  const supervisor = new RuntimeSupervisor(() => worker);
  supervisor.start();
  await supervisor.stop();
  expect(worker.kill).toHaveBeenCalledOnce();
  expect(supervisor.getStatus().state).toBe('stopped');
});
```

Define `RuntimeWorkerPort` in `runtime-supervisor.ts` with `on('message', listener)`, `postMessage(message)`, and `kill(): boolean`. The production factory wraps Electron's `UtilityProcess`; tests inject the event-emitting double above.

- [ ] **Step 2: Run the supervisor tests and confirm failure**

Run: `pnpm --filter @catbots/desktop test -- runtime-supervisor.test.ts`

Expected: FAIL because `RuntimeSupervisor` is missing.

- [ ] **Step 3: Implement utility-process supervision and close-to-tray lifecycle**

Use `utilityProcess.fork` for a worker that reports `ready` and responds to `shutdown`; it performs no strategy or network activity in M0. Keep the Electron app alive after the window closes, expose Open Catbots and Quit Catbots tray items, and make Quit await `RuntimeSupervisor.stop()` before `app.quit()`.

The Main process owns the emergency lifecycle path. Renderer failure must not remove the tray or make Quit unavailable.

- [ ] **Step 4: Run supervisor tests and manual tray verification**

Run: `pnpm --filter @catbots/desktop test -- runtime-supervisor.test.ts`

Expected: PASS.

Run: `pnpm dev`

Expected: closing the window leaves the tray icon present; Open Catbots restores the window; Quit terminates the utility process and app.

- [ ] **Step 5: Commit runtime lifecycle**

```bash
git add apps/desktop/src/main/runtime apps/desktop/src/main/tray apps/desktop/src/main/main.ts apps/desktop/assets packages/contracts/src/ipc.ts apps/desktop/tests/runtime-supervisor.test.ts
git commit -m "feat: supervise local runtime from system tray"
```

---

### Task 9: Add desktop smoke tests, packaging, and contributor documentation

**Files:**

- Create: `playwright.config.ts`
- Create: `e2e/desktop-smoke.spec.ts`
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `local.env.example.yaml`
- Modify: `.gitignore`
- Modify: `apps/desktop/forge.config.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: packaged Electron entry point and M0 preload API.
- Produces: `pnpm test`, `pnpm test:e2e`, and `pnpm make` contributor/release gates.

- [ ] **Step 1: Write the failing Electron smoke test**

```ts
import { _electron as electron, expect, test } from '@playwright/test';

test('fresh install reaches local-profile onboarding', async () => {
  const app = await electron.launch({
    args: ['apps/desktop/.vite/build/main.js'],
    env: { ...process.env, CATBOTS_E2E_DATA_DIR: testDataDir },
  });
  const window = await app.firstWindow();
  await expect(window.getByRole('heading', { name: 'Create your local profile' })).toBeVisible();
  await app.close();
});
```

- [ ] **Step 2: Run the E2E test and confirm the missing test-mode data-directory failure**

Run: `pnpm test:e2e`

Expected: FAIL because `CATBOTS_E2E_DATA_DIR` is not wired into the Main-process data-directory resolver.

- [ ] **Step 3: Add deterministic E2E data-directory injection and packaging scripts**

Honor `CATBOTS_E2E_DATA_DIR` only when the packaged app is not production-signed and `NODE_ENV === 'test'`. Add Forge makers for the current development platform, a package-time check that `local.env.yaml` is excluded, and scripts for build, test, E2E, package, and make.

- [ ] **Step 4: Document installation, local data, security boundaries, and contribution commands**

`README.md` must describe M0 capabilities without implying trading works yet. `local.env.example.yaml` contains obvious non-secret sample values such as `replace-me`. `SECURITY.md` documents private vulnerability reporting and explicitly forbids including credentials. `CONTRIBUTING.md` includes `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm make`.

- [ ] **Step 5: Run the full M0 verification gate**

Run: `pnpm typecheck`

Expected: exit 0.

Run: `pnpm test`

Expected: all unit and renderer tests pass.

Run: `pnpm test:e2e`

Expected: Electron smoke tests pass using a temporary local data directory.

Run: `pnpm make`

Expected: the current-platform distributable is created under `apps/desktop/out/make`, launches First Launch, and contains neither `local.env.yaml` nor visual-companion artifacts.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended documentation updates, if any, remain.

- [ ] **Step 6: Commit the M0 delivery gate**

```bash
git add package.json playwright.config.ts e2e README.md CONTRIBUTING.md SECURITY.md local.env.example.yaml .gitignore apps/desktop/forge.config.ts
git commit -m "test: add desktop foundation release gate"
```

---

## M0 Completion Criteria

- A clean checkout installs with `pnpm install` and passes type, unit, renderer, and Electron smoke tests.
- A user can create a Local Profile and configure/test either compatible LLM protocol through Kumo forms.
- Valid settings survive restart in `local.env.yaml`; invalid YAML opens repair mode; rendered/returned errors reveal no secrets.
- A user can create and reopen a local Draft Bot record from Bots Home.
- The sandboxed renderer has no Node.js integration and no generic IPC escape hatch.
- Closing the window keeps the runtime skeleton alive in the tray; Quit stops it cleanly.
- The current-platform installer launches successfully and excludes local secrets and brainstorming artifacts.
- README states clearly that trading, Backtest, Strategy Runtime, and Hyperliquid execution arrive in later milestones.
