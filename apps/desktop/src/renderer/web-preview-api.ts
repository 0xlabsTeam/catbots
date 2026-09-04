import {
  CreateDraftBotInputSchema,
  LocalSettingsPatchSchema,
  REDACTED_SECRET,
  type BotSummary,
  type CatbotsDesktopApi,
  type RedactedLocalConfig,
} from '@catbots/contracts';

export function createWebPreviewApi(): CatbotsDesktopApi {
  let config: RedactedLocalConfig | undefined;
  const bots: BotSummary[] = [];

  return {
    app: {
      getVersion: async () => 'web-preview',
      showMainWindow: async () => undefined,
      quitApplication: async () => undefined,
    },
    config: {
      getBootstrapState: async () => config === undefined
        ? { state: 'first-launch' }
        : { state: 'ready', config },
      patchSettings: async (input) => {
        const parsed = LocalSettingsPatchSchema.parse(input);
        config = {
          profile: parsed.profile,
          llm: {
            provider: parsed.llm.provider,
            baseUrl: parsed.llm.baseUrl,
            model: parsed.llm.model,
            apiKey: REDACTED_SECRET,
          },
          exchanges: {},
        };
        return config;
      },
      testLlmConnection: async (input) => {
        const parsed = LocalSettingsPatchSchema.parse(input);
        return { ok: true, model: parsed.llm.model };
      },
    },
    bots: {
      list: async () => [...bots],
      createDraft: async (input) => {
        const parsed = CreateDraftBotInputSchema.parse(input);
        const timestamp = new Date().toISOString();
        const draft: BotSummary = {
          ...parsed,
          id: crypto.randomUUID(),
          status: 'draft',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        bots.push(draft);
        return draft;
      },
    },
    runtime: {
      getStatus: async () => ({ state: 'stopped', activeBots: 0 }),
      subscribeStatus: () => () => undefined,
    },
  };
}
