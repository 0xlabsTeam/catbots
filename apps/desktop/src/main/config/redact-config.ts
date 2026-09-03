import { REDACTED_SECRET, type LocalConfig, type RedactedLocalConfig } from '@catbots/contracts';

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
