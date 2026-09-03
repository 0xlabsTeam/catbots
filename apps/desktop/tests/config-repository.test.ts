import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalConfig } from '@catbots/contracts';
import { ConfigParseError, ConfigRepository } from '../src/main/config/config-repository';

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
});

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

  it('preserves the previous valid configuration when replacement input is invalid', async () => {
    const dataDirectory = await createTemporaryDirectory();
    const repository = new ConfigRepository(dataDirectory);
    await repository.save(validConfig);

    await expect(repository.save({
      ...validConfig,
      profile: { ...validConfig.profile, name: '' },
    })).rejects.toThrow();

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
});
