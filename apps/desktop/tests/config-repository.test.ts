import * as fs from 'node:fs/promises';
import { lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDACTED_SECRET, type LocalConfig } from '@catbots/contracts';
import {
  ConfigParseError,
  ConfigRepository,
  LlmCredentialReplacementRequiredError,
} from '../src/main/config/config-repository';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
  };
});

const llmSecret = 'llm-secret-that-must-not-leak';
const agentSecret = 'agent-secret-that-must-not-leak';

const validConfig: LocalConfig = {
  profile: { name: 'My Trading', telemetry: false },
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: llmSecret,
    model: 'provider/model',
  },
  exchanges: {
    hyperliquid: {
      network: 'testnet',
      accountAddress: '0x0123456789abcdef0123456789abcdef01234567',
      agentPrivateKey: agentSecret,
    },
  },
};

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'catbots-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  vi.clearAllMocks();
});

function stageFailure(stage: string): Error {
  return new Error(`${stage} failed`);
}

async function expectFailureToPreserveTarget(
  repository: ConfigRepository,
  dataDirectory: string,
): Promise<void> {
  const target = join(dataDirectory, 'local.env.yaml');
  const before = await readFile(target, 'utf8');
  const error = await repository.save({ ...validConfig, profile: { ...validConfig.profile, name: 'Replacement' } })
    .catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(Error);
  await expect(readFile(target, 'utf8')).resolves.toBe(before);
  expect((await readdir(dataDirectory)).filter((entry) => entry.startsWith('.local.env.yaml.'))).toEqual([]);
  expect(String(error)).not.toContain(llmSecret);
  expect(String(error)).not.toContain(agentSecret);
  expect(JSON.stringify(error)).not.toContain(llmSecret);
  expect(JSON.stringify(error)).not.toContain(agentSecret);
}

function failNextTemporaryFileOperation(operation: 'writeFile' | 'sync'): void {
  const openMock = vi.mocked(fs.open);
  const original = openMock.getMockImplementation();
  if (original === undefined) throw new Error('Expected filesystem open mock implementation');

  openMock.mockImplementationOnce(async (...args) => {
    const handle = await original(...args);
    if (operation === 'writeFile') {
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(stageFailure('temporary write'));
    } else {
      vi.spyOn(handle, 'sync').mockRejectedValueOnce(stageFailure('temporary sync'));
    }
    return handle;
  });
}

describe('ConfigRepository', () => {
  it('writes valid YAML atomically with private permissions and returns a redacted view', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);

    const result = await repository.save(validConfig);
    const source = await readFile(join(dataDirectory, 'local.env.yaml'), 'utf8');

    expect(result.llm.apiKey).toBe('••••••••');
    expect(result.exchanges.hyperliquid?.agentPrivateKey).toBe('••••••••');
    expect(source).toContain(`api_key: ${llmSecret}`);
    expect(source).toContain(`agent_private_key: ${agentSecret}`);
    expect(source).toContain('base_url: https://api.example.com/v1');
    expect(source).toContain('account_address:');
    expect((await stat(join(dataDirectory, 'local.env.yaml'))).mode & 0o777).toBe(0o600);
    expect(await readdir(dataDirectory)).not.toContain('local.env.yaml.tmp');
    await expect(repository.load()).resolves.toEqual(validConfig);
    await expect(repository.getRedacted()).resolves.toEqual(result);
  });

  it('patches editable non-secret settings while preserving the stored LLM key and Hyperliquid subtree', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);

    const result = await repository.patchSettings({
      profile: { name: 'Renamed', telemetry: true },
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'replacement-model',
      },
    });

    expect(result).toEqual({
      profile: { name: 'Renamed', telemetry: true },
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: REDACTED_SECRET,
        model: 'replacement-model',
      },
      exchanges: {
        hyperliquid: {
          ...validConfig.exchanges.hyperliquid,
          agentPrivateKey: REDACTED_SECRET,
        },
      },
    });
    await expect(repository.load()).resolves.toEqual({
      profile: { name: 'Renamed', telemetry: true },
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: llmSecret,
        model: 'replacement-model',
      },
      exchanges: validConfig.exchanges,
    });
  });

  it('uses an optional replacement LLM key without replacing exchange credentials', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);

    await repository.patchSettings({
      profile: validConfig.profile,
      llm: {
        provider: 'anthropic-compatible',
        baseUrl: 'https://replacement.example/v2',
        apiKey: 'replacement-llm-key',
        model: 'replacement-model',
      },
    });

    expect(await repository.load()).toEqual({
      profile: validConfig.profile,
      llm: {
        provider: 'anthropic-compatible',
        baseUrl: 'https://replacement.example/v2',
        apiKey: 'replacement-llm-key',
        model: 'replacement-model',
      },
      exchanges: validConfig.exchanges,
    });
  });

  it.each([
    ['provider', { provider: 'anthropic-compatible' as const, baseUrl: validConfig.llm.baseUrl }],
    ['base origin', { provider: validConfig.llm.provider, baseUrl: 'https://other.example/v1' }],
    ['base path', { provider: validConfig.llm.provider, baseUrl: 'https://api.example.com/v1/tenant' }],
  ])('requires a replacement key when the credential %s changes without touching the file', async (_label, scope) => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const target = join(dataDirectory, 'local.env.yaml');
    const before = await readFile(target, 'utf8');
    const patch = {
      profile: { name: 'Must not persist', telemetry: true },
      llm: { ...scope, model: 'replacement-model' },
    };

    const resolutionError = await repository.resolveSettingsPatch(patch).catch((reason: unknown) => reason);
    const saveError = await repository.patchSettings(patch).catch((reason: unknown) => reason);

    for (const error of [resolutionError, saveError]) {
      expect(error).toBeInstanceOf(LlmCredentialReplacementRequiredError);
      expect(error).toMatchObject({ code: 'LLM_CREDENTIAL_REPLACEMENT_REQUIRED' });
      expect(String(error)).not.toContain(scope.baseUrl);
      expect(String(error)).not.toContain(llmSecret);
    }
    await expect(readFile(target, 'utf8')).resolves.toBe(before);
    await expect(repository.load()).resolves.toEqual(validConfig);
  });

  it('reuses the stored key for an equivalent canonical base URL', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const patch = {
      profile: { name: 'Canonical spelling', telemetry: true },
      llm: {
        provider: validConfig.llm.provider,
        baseUrl: 'HTTPS://API.EXAMPLE.COM:443/v1/',
        model: 'replacement-model',
      },
    } as const;

    await expect(repository.resolveSettingsPatch(patch)).resolves.toMatchObject({
      llm: { apiKey: llmSecret },
      exchanges: validConfig.exchanges,
    });
    await expect(repository.patchSettings(patch)).resolves.toMatchObject({
      llm: { apiKey: REDACTED_SECRET },
      exchanges: {
        hyperliquid: { agentPrivateKey: REDACTED_SECRET },
      },
    });
    expect((await repository.load())?.llm.apiKey).toBe(llmSecret);
  });

  it('requires a real API key when no valid stored configuration exists', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);

    const patch = {
      profile: validConfig.profile,
      llm: {
        provider: validConfig.llm.provider,
        baseUrl: validConfig.llm.baseUrl,
        model: validConfig.llm.model,
      },
    } as const;

    await expect(repository.resolveSettingsPatch(patch)).rejects.toMatchObject({
      code: 'LLM_CREDENTIAL_REPLACEMENT_REQUIRED',
    });
    await expect(repository.patchSettings(patch)).rejects.toMatchObject({
      code: 'LLM_CREDENTIAL_REPLACEMENT_REQUIRED',
    });
    await expect(repository.load()).resolves.toBeNull();
  });

  it('rejects the redacted display mask instead of persisting it as a replacement key', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);

    await expect(repository.patchSettings({
      profile: validConfig.profile,
      llm: { ...validConfig.llm, apiKey: REDACTED_SECRET },
    })).rejects.toBeInstanceOf(ConfigParseError);
    expect((await repository.load())?.llm.apiKey).toBe(llmSecret);
  });

  it('preserves the previous valid configuration when replacement input is invalid', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);

    const error = await repository.save({
      ...validConfig,
      profile: { ...validConfig.profile, name: '' },
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConfigParseError);
    expect(String(error)).not.toContain(llmSecret);
    expect(String(error)).not.toContain(agentSecret);
    expect(JSON.stringify(error)).not.toContain(llmSecret);
    expect(JSON.stringify(error)).not.toContain(agentSecret);
    expect((await repository.load())?.profile.name).toBe('My Trading');
    expect(await readdir(dataDirectory)).not.toContain('local.env.yaml.tmp');
  });

  it('retains one rollback copy of the configuration that was replaced', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    await repository.save({ ...validConfig, profile: { ...validConfig.profile, name: 'Replacement' } });

    const previous = await readFile(join(dataDirectory, 'local.env.yaml.previous'), 'utf8');

    expect(previous).toContain('name: My Trading');
    expect((await stat(join(dataDirectory, 'local.env.yaml.previous'))).mode & 0o777).toBe(0o600);
  });

  it('returns null when no local configuration exists', async () => {
    const repository = new ConfigRepository(await createTemporaryDirectory());

    await expect(repository.load()).resolves.toBeNull();
    await expect(repository.getRedacted()).resolves.toBeNull();
  });

  it('reports malformed YAML with safe field paths and no secret values', async () => {
    const dataDirectory = await createTemporaryDirectory();
    await writeFile(join(dataDirectory, 'local.env.yaml'), [
      'profile:',
      '  name: My Trading',
      '  telemetry: false',
      'llm:',
      '  provider: openai-compatible',
      '  base_url: https://api.example.com/v1',
      `  api_key: ${llmSecret}`,
      '  model: provider/model',
      'exchanges:',
      '  hyperliquid:',
      '    network: testnet',
      '    account_address: not-an-address',
      `    agent_private_key: ${agentSecret}`,
      '',
    ].join('\n'), 'utf8');
    const repository = new ConfigRepository(dataDirectory);

    const error = await repository.load().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConfigParseError);
    expect((error as ConfigParseError).issues).toEqual([
      { path: 'exchanges.hyperliquid.accountAddress', message: 'Invalid configuration value' },
    ]);
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(llmSecret);
    expect(serialized).not.toContain(agentSecret);
    expect(String(error)).not.toContain(llmSecret);
    expect(String(error)).not.toContain(agentSecret);
  });

  it('redacts YAML syntax errors before returning them to the caller', async () => {
    const dataDirectory = await createTemporaryDirectory();
    await writeFile(join(dataDirectory, 'local.env.yaml'), `llm: [${llmSecret}\n`, 'utf8');
    const repository = new ConfigRepository(dataDirectory);

    const error = await repository.load().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConfigParseError);
    expect((error as ConfigParseError).issues).toEqual([
      { path: 'config', message: 'Invalid configuration file' },
    ]);
    expect(JSON.stringify(error)).not.toContain(llmSecret);
    expect(String(error)).not.toContain(llmSecret);
  });

  it('rejects camelCase aliases mixed into otherwise valid YAML without exposing secrets', async () => {
    const dataDirectory = await createTemporaryDirectory();
    await writeFile(join(dataDirectory, 'local.env.yaml'), [
      'profile:',
      '  name: My Trading',
      '  telemetry: false',
      'llm:',
      '  provider: openai-compatible',
      '  base_url: https://api.example.com/v1',
      `  api_key: ${llmSecret}`,
      '  model: provider/model',
      '  baseUrl: https://attacker.example/v1',
      'exchanges:',
      '  hyperliquid:',
      '    network: testnet',
      '    account_address: "0x0123456789abcdef0123456789abcdef01234567"',
      `    agent_private_key: ${agentSecret}`,
      `    agentPrivateKey: ${agentSecret}`,
      '',
    ].join('\n'), 'utf8');
    const repository = new ConfigRepository(dataDirectory);

    const error = await repository.load().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConfigParseError);
    expect(JSON.stringify(error)).not.toContain(llmSecret);
    expect(JSON.stringify(error)).not.toContain(agentSecret);
    expect(String(error)).not.toContain(llmSecret);
    expect(String(error)).not.toContain(agentSecret);
  });

  it('does not follow a stale fixed-name temporary-file symlink', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const outsidePath = join(dataDirectory, 'outside.yaml');
    await writeFile(outsidePath, 'outside sentinel', 'utf8');
    await symlink(outsidePath, join(dataDirectory, 'local.env.yaml.tmp'));

    await repository.save({ ...validConfig, profile: { ...validConfig.profile, name: 'Replacement' } });

    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside sentinel');
    expect((await lstat(join(dataDirectory, 'local.env.yaml'))).isSymbolicLink()).toBe(false);
    expect((await repository.load())?.profile.name).toBe('Replacement');
  });

  it('serializes concurrent saves so the last queued configuration becomes current', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);

    await Promise.all([
      repository.save({ ...validConfig, profile: { ...validConfig.profile, name: 'First' } }),
      repository.save({ ...validConfig, profile: { ...validConfig.profile, name: 'Second' } }),
    ]);

    expect((await repository.load())?.profile.name).toBe('Second');
    await expect(readFile(join(dataDirectory, 'local.env.yaml.previous'), 'utf8')).resolves.toContain('name: First');
  });

  it('cleans its exclusive temporary file after a write failure without changing the target', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    failNextTemporaryFileOperation('writeFile');

    await expectFailureToPreserveTarget(repository, dataDirectory);
  });

  it('cleans its exclusive temporary file after an fsync failure without changing the target', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    failNextTemporaryFileOperation('sync');

    await expectFailureToPreserveTarget(repository, dataDirectory);
  });

  it('sanitizes temporary-file validation failures and keeps the target unchanged', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const readFileMock = vi.mocked(fs.readFile);
    const original = readFileMock.getMockImplementation();
    if (original === undefined) throw new Error('Expected filesystem readFile mock implementation');
    readFileMock.mockImplementation(async (path, ...args) => {
      if (String(path).includes('.local.env.yaml.')) return `llm: [${llmSecret}\n` as never;
      return original(path, ...args);
    });

    try {
      await expectFailureToPreserveTarget(repository, dataDirectory);
    } finally {
      readFileMock.mockImplementation(original);
    }
  });

  it('cleans temporary artifacts when reading the temporary file fails without changing the target', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const readFileMock = vi.mocked(fs.readFile);
    const original = readFileMock.getMockImplementation();
    if (original === undefined) throw new Error('Expected filesystem readFile mock implementation');
    readFileMock.mockImplementation(async (path, ...args) => {
      if (String(path).includes('.local.env.yaml.')) throw stageFailure('temporary read');
      return original(path, ...args);
    });

    try {
      await expectFailureToPreserveTarget(repository, dataDirectory);
    } finally {
      readFileMock.mockImplementation(original);
    }
  });

  it('cleans temporary artifacts when rollback copying fails without changing the target', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    vi.mocked(fs.copyFile).mockRejectedValueOnce(stageFailure('rollback copy'));

    await expectFailureToPreserveTarget(repository, dataDirectory);
  });

  it('cleans temporary artifacts when target replacement fails without changing the target', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const renameMock = vi.mocked(fs.rename);
    const original = renameMock.getMockImplementation();
    if (original === undefined) throw new Error('Expected filesystem rename mock implementation');
    renameMock.mockImplementation(async (oldPath, newPath) => {
      if (newPath === join(dataDirectory, 'local.env.yaml')) throw stageFailure('target rename');
      return original(oldPath, newPath);
    });

    try {
      await expectFailureToPreserveTarget(repository, dataDirectory);
    } finally {
      renameMock.mockImplementation(original);
    }
  });

  it('keeps the target unchanged when parent-directory fsync fails before replacement', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);
    const openMock = vi.mocked(fs.open);
    const original = openMock.getMockImplementation();
    if (original === undefined) throw new Error('Expected filesystem open mock implementation');
    openMock.mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (args[0] === dataDirectory && args[1] === 'r') {
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(stageFailure('parent directory sync'));
      }
      return handle;
    });

    try {
      await expectFailureToPreserveTarget(repository, dataDirectory);
    } finally {
      openMock.mockImplementation(original);
    }
  });
});
