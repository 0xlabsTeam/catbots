import { access, chmod, copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { LocalConfigSchema, type LocalConfig, type RedactedLocalConfig } from '@catbots/contracts';
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

export class ConfigRepository {
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
    const target = this.configPath;
    const temporary = join(this.dataDir, 'local.env.yaml.tmp');
    const previous = join(this.dataDir, 'local.env.yaml.previous');
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });

    let temporaryExists = false;
    try {
      const handle = await open(temporary, 'w', 0o600);
      temporaryExists = true;
      try {
        await handle.writeFile(serializeLocalConfig(value), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      parseLocalConfig(await readFile(temporary, 'utf8'));
      if (await fileExists(target)) {
        await copyFile(target, previous);
        await chmod(previous, 0o600).catch(ignoreUnsupportedPermissionError);
      }
      await rename(temporary, target);
      temporaryExists = false;
      await chmod(target, 0o600).catch(ignoreUnsupportedPermissionError);

      return redactLocalConfig(value);
    } finally {
      if (temporaryExists) await unlink(temporary).catch(ignoreMissingFileError);
    }
  }

  async getRedacted(): Promise<RedactedLocalConfig | null> {
    const value = await this.load();
    return value === null ? null : redactLocalConfig(value);
  }

  private get configPath(): string {
    return join(this.dataDir, 'local.env.yaml');
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
  return LocalConfigSchema.parse(fromYamlShape(parseYaml(source)));
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

function validateConfig(input: LocalConfig): LocalConfig {
  try {
    return LocalConfigSchema.parse(input);
  } catch (error) {
    throw toConfigParseError(error);
  }
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

function fromYamlShape(value: unknown): unknown {
  if (!isRecord(value)) return value;

  return {
    ...value,
    llm: fromYamlLlm(value.llm),
    exchanges: fromYamlExchanges(value.exchanges),
  };
}

function fromYamlLlm(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const { api_key: apiKey, base_url: baseUrl, ...rest } = value;
  return { ...rest, apiKey, baseUrl };
}

function fromYamlExchanges(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const { hyperliquid, ...rest } = value;
  return {
    ...rest,
    hyperliquid: fromYamlHyperliquid(hyperliquid),
  };
}

function fromYamlHyperliquid(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const { account_address: accountAddress, agent_private_key: agentPrivateKey, ...rest } = value;
  return { ...rest, accountAddress, agentPrivateKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function ignoreMissingFileError(error: unknown): void {
  if (!hasCode(error, 'ENOENT')) throw error;
}
