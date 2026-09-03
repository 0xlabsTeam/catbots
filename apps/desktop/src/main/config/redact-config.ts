import type { LocalConfig, RedactedLocalConfig } from '@catbots/contracts';

const REDACTED_SECRET = '••••••••' as const;

export function redactLocalConfig(value: LocalConfig): RedactedLocalConfig {
  const hyperliquid = value.exchanges.hyperliquid;

  return {
    ...value,
    llm: {
      ...value.llm,
      apiKey: REDACTED_SECRET,
    },
    exchanges: hyperliquid === undefined
      ? {}
      : {
          hyperliquid: {
            ...hyperliquid,
            agentPrivateKey: REDACTED_SECRET,
          },
        },
  };
}
