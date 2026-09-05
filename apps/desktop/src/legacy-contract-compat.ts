import type { BotSummary, Deployment, LegacyRiskLimits, RiskLimits } from '@catbots/contracts';

/**
 * Internal bridge for code that still reads pre-migration storage fields.
 * Public contracts deliberately do not expose these fields.
 */
export function legacyMarketHint(bot: object): string {
  return (bot as unknown as { market: string }).market;
}

export function legacyMarketBindings(deployment: Deployment): string[] {
  return (deployment as unknown as { marketBindings: string[] }).marketBindings;
}

export function legacyDeploymentFields(deployment: Deployment): {
  venue: 'paper' | 'hyperliquid';
  network: 'paper' | 'testnet';
  marketBindings: string[];
} {
  return deployment as unknown as {
    venue: 'paper' | 'hyperliquid';
    network: 'paper' | 'testnet';
    marketBindings: string[];
  };
}

export function legacyRiskLimits(limits: RiskLimits): LegacyRiskLimits {
  return limits as unknown as LegacyRiskLimits;
}
