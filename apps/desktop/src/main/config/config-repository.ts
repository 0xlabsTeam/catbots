import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { access, chmod, copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  hasSameLlmCredentialScope,
  LocalConfigSchema,
  LocalSettingsPatchSchema,
  type LocalConfig,
  type LocalSettingsPatch,
  type RedactedLocalConfig,
} from '@catbots/contracts';
import { redactLocalConfig } from './redact-config';

type ConfigParseIssue = {
  path: string;
  message: string;
};

export class ConfigParseError extends Error {
  readonly issues: readonly ConfigParseIssue[];

  constructor(issues: readonly ConfigParseIssue[]) {
    super('Local configuration is invalid');
    this.name = 'ConfigParseError';
    this.issues = issues;
  }

  toJSON(): { name: string; message: string; issues: readonly ConfigParseIssue[] } {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues,
    };
  }
}

export class LlmCredentialReplacementRequiredError extends Error {
  readonly code = 'LLM_CREDENTIAL_REPLACEMENT_REQUIRED' as const;

  constructor() {
    super('A new API key is required for this provider location');
    this.name = 'LlmCredentialReplacementRequiredError';
  }
}

export class HyperliquidCredentialReplacementRequiredError extends Error {
  readonly code = 'HYPERLIQUID_CREDENTIAL_REPLACEMENT_REQUIRED' as const;

  constructor() {
    super('A new Agent private key is required for this Hyperliquid account');
    this.name = 'HyperliquidCredentialReplacementRequiredError';
  }
}

const YamlLocalConfigSchema = z.object({
  profile: z.object({
    name: z.unknown().optional(),
    telemetry: z.unknown().optional(),
  }).strict().optional(),
  llm: z.object({
    provider: z.unknown().optional(),
    base_url: z.unknown().optional(),
    api_key: z.unknown().optional(),
    model: z.unknown().optional(),
    reasoning_effort: z.unknown().optional(),
  }).strict().optional(),
  exchanges: z.object({
    hyperliquid: z.object({
      network: z.unknown().optional(),
      account_address: z.unknown().optional(),
      agent_private_key: z.unknown().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict();

type YamlLocalConfig = z.infer<typeof YamlLocalConfigSchema>;

export class ConfigRepository {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  async load(): Promise<LocalConfig | null> {
    const target = this.configPath;

    let source: string;
    try {
      source = await readFile(target, 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }

    try {
      return parseLocalConfig(source);
    } catch (error) {
      throw toConfigParseError(error);
    }
  }

  async save(input: LocalConfig): Promise<RedactedLocalConfig> {
    const value = validateConfig(input);
    return this.enqueueSave(() => this.saveValue(value));
  }

  async resolveSettingsPatch(input: LocalSettingsPatch): Promise<LocalConfig> {
    const patch = validateSettingsPatch(input);
    await this.saveQueue;
    return mergeSettingsPatch(await this.loadExistingSettings(), patch);
  }

  async patchSettings(input: LocalSettingsPatch): Promise<RedactedLocalConfig> {
    const patch = validateSettingsPatch(input);
    return this.enqueueSave(async () => {
      const value = mergeSettingsPatch(await this.loadExistingSettings(), patch);
      return this.saveValue(value);
    });
  }

  async getRedacted(): Promise<RedactedLocalConfig | null> {
    const value = await this.load();
    return value === null ? null : redactLocalConfig(value);
  }

  private enqueueSave<T>(operation: () => Promise<T>): Promise<T> {
    // Settings writes are serialized per repository; the last queued write becomes current.
    const saving = this.saveQueue.then(operation);
    this.saveQueue = saving.then(
      () => undefined,
      () => undefined,
    );
    return saving;
  }

  private async loadExistingSettings(): Promise<LocalConfig | null> {
    try {
      return await this.load();
    } catch (error) {
      if (error instanceof ConfigParseError) return null;
      throw error;
    }
  }

  private async saveValue(value: LocalConfig): Promise<RedactedLocalConfig> {
    const target = this.configPath;
    const previous = join(this.dataDir, 'local.env.yaml.previous');
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });

    const temporary = await this.openExclusiveTemporaryFile('local.env.yaml');
    let temporaryExists = true;
    let previousTemporary: string | null = null;
    try {
      try {
        await temporary.handle.writeFile(serializeLocalConfig(value), 'utf8');
        await temporary.handle.sync();
      } finally {
        await temporary.handle.close();
      }

      try {
        parseLocalConfig(await readFile(temporary.path, 'utf8'));
      } catch (error) {
        throw toConfigParseError(error);
      }
      if (await fileExists(target)) {
        previousTemporary = this.temporaryPath('local.env.yaml.previous');
        await copyFile(target, previousTemporary, constants.COPYFILE_EXCL);
        await chmod(previousTemporary, 0o600).catch(ignoreUnsupportedPermissionError);
        await syncFile(previousTemporary);
        await rename(previousTemporary, previous);
        previousTemporary = null;
        await syncParentDirectory(this.dataDir);
      }
      await rename(temporary.path, target);
      temporaryExists = false;
      await chmod(target, 0o600).catch(ignoreUnsupportedPermissionError);
      await syncParentDirectory(this.dataDir);

      return redactLocalConfig(value);
    } finally {
      if (temporaryExists) await unlink(temporary.path).catch(ignoreMissingFileError);
      if (previousTemporary !== null) await unlink(previousTemporary).catch(ignoreMissingFileError);
    }
  }

  private get configPath(): string {
    return join(this.dataDir, 'local.env.yaml');
  }

  private async openExclusiveTemporaryFile(prefix: string): Promise<{ path: string; handle: Awaited<ReturnType<typeof open>> }> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const path = this.temporaryPath(prefix);
      try {
        return { path, handle: await open(path, 'wx', 0o600) };
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
    }

    throw new Error('Unable to create an exclusive configuration temporary file');
  }

  private temporaryPath(prefix: string): string {
    return join(this.dataDir, `.${prefix}.${randomUUID()}.tmp`);
  }
}

function serializeLocalConfig(value: LocalConfig): string {
  return stringifyYaml({
    profile: value.profile,
    llm: {
      provider: value.llm.provider,
      base_url: value.llm.baseUrl,
      api_key: value.llm.apiKey,
      model: value.llm.model,
      ...(value.llm.provider === 'openai-compatible' && value.llm.reasoningEffort !== undefined
        ? { reasoning_effort: value.llm.reasoningEffort }
        : {}),
    },
    exchanges: value.exchanges.hyperliquid === undefined
      ? {}
      : {
          hyperliquid: {
            network: value.exchanges.hyperliquid.network,
            account_address: value.exchanges.hyperliquid.accountAddress,
            agent_private_key: value.exchanges.hyperliquid.agentPrivateKey,
          },
        },
  });
}

function parseLocalConfig(source: string): LocalConfig {
  return LocalConfigSchema.parse(fromYamlShape(YamlLocalConfigSchema.parse(parseYaml(source))));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function ignoreUnsupportedPermissionError(error: unknown): void {
  if (process.platform === 'win32' && (hasCode(error, 'ENOSYS') || hasCode(error, 'EINVAL') || hasCode(error, 'ENOTSUP'))) {
    return;
  }
  throw error;
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    ignoreUnsupportedDirectorySyncError(error);
  } finally {
    if (handle !== undefined) await handle.close();
  }
}

function ignoreUnsupportedDirectorySyncError(error: unknown): void {
  if (process.platform === 'win32' && (
    hasCode(error, 'EISDIR')
    || hasCode(error, 'EINVAL')
    || hasCode(error, 'ENOSYS')
    || hasCode(error, 'ENOTSUP')
    || hasCode(error, 'EPERM')
  )) {
    return;
  }
  throw error;
}

function validateConfig(input: unknown): LocalConfig {
  try {
    return LocalConfigSchema.parse(input);
  } catch (error) {
    throw toConfigParseError(error);
  }
}

function validateSettingsPatch(input: unknown): LocalSettingsPatch {
  try {
    return LocalSettingsPatchSchema.parse(input);
  } catch (error) {
    throw toConfigParseError(error);
  }
}

function mergeSettingsPatch(existing: LocalConfig | null, patch: LocalSettingsPatch): LocalConfig {
  const apiKey = patch.llm.apiKey ?? reusableApiKey(existing, patch);
  const exchanges = mergeExchangeSettings(existing, patch);
  return validateConfig({
    profile: patch.profile,
    llm: {
      ...patch.llm,
      apiKey,
    },
    exchanges,
  });
}

function mergeExchangeSettings(existing: LocalConfig | null, patch: LocalSettingsPatch): LocalConfig['exchanges'] {
  if (patch.exchanges === undefined) return existing?.exchanges ?? {};
  const hyperliquid = patch.exchanges.hyperliquid;
  if (hyperliquid === null) return {};
  const existingHyperliquid = existing?.exchanges.hyperliquid;
  const sameScope = existingHyperliquid?.network === hyperliquid.network
    && existingHyperliquid.accountAddress.toLowerCase() === hyperliquid.accountAddress.toLowerCase();
  const agentPrivateKey = hyperliquid.agentPrivateKey ?? (sameScope ? existingHyperliquid.agentPrivateKey : undefined);
  if (agentPrivateKey === undefined) throw new HyperliquidCredentialReplacementRequiredError();
  return { hyperliquid: { ...hyperliquid, agentPrivateKey } };
}

function reusableApiKey(existing: LocalConfig | null, patch: LocalSettingsPatch): string {
  if (existing === null || !hasSameLlmCredentialScope(existing.llm, patch.llm)) {
    throw new LlmCredentialReplacementRequiredError();
  }
  return existing.llm.apiKey;
}

function toConfigParseError(error: unknown): ConfigParseError {
  if (error instanceof ConfigParseError) return error;
  if (error instanceof z.ZodError) {
    return new ConfigParseError(error.issues.map((issue) => ({
      path: issue.path.length === 0 ? 'config' : issue.path.join('.'),
      message: 'Invalid configuration value',
    })));
  }
  return new ConfigParseError([{ path: 'config', message: 'Invalid configuration file' }]);
}

function fromYamlShape(value: YamlLocalConfig): unknown {
  return {
    ...(value.profile === undefined ? {} : { profile: value.profile }),
    ...(value.llm === undefined
      ? {}
      : {
          llm: {
            provider: value.llm.provider,
            baseUrl: value.llm.base_url,
            apiKey: value.llm.api_key,
            model: value.llm.model,
            ...(value.llm.reasoning_effort === undefined ? {} : { reasoningEffort: value.llm.reasoning_effort }),
          },
        }),
    ...(value.exchanges === undefined
      ? {}
      : {
          exchanges: value.exchanges.hyperliquid === undefined
            ? {}
            : {
                hyperliquid: {
                  network: value.exchanges.hyperliquid.network,
                  accountAddress: value.exchanges.hyperliquid.account_address,
                  agentPrivateKey: value.exchanges.hyperliquid.agent_private_key,
                },
              },
        }),
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function ignoreMissingFileError(error: unknown): void {
  if (!hasCode(error, 'ENOENT')) throw error;
}
