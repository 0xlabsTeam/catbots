import { useState } from 'react';
import { Banner, Button, Input, LayerCard, Select } from '@cloudflare/kumo';
import { RiskLimitsSchema, type BotSummary, type RiskLimits, type StrategyRevision } from '@catbots/contracts';

import { DeploymentScopeSummary, isDynamicDeploymentEligible } from '../workbench/DeploymentScopeSummary';

export type PaperReviewScreenProps = Readonly<{
  bot: BotSummary;
  revision: StrategyRevision;
  initialRiskLimits: RiskLimits;
  onCancel(): void;
  onStart(riskLimits: RiskLimits): Promise<void>;
}>;

type RiskForm = {
  maxOrderUsd: string;
  maxPositionUsd: string;
  maxTotalExposureUsd: string;
  maxLeverage: string;
  maxDailyLossUsd: string;
  maxDrawdownPercent: string;
  allowedSides: 'both' | 'long' | 'short';
  maxOrdersPerMinute: string;
};

export function PaperReviewScreen({ bot, revision, initialRiskLimits, onCancel, onStart }: PaperReviewScreenProps) {
  const [form, setForm] = useState<RiskForm>(() => toForm(initialRiskLimits));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validation = validate(form);

  const update = (field: keyof RiskForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const start = async () => {
    if (!isDynamicDeploymentEligible(revision) || validation.riskLimits === null) return;
    setStarting(true);
    setError(null);
    try {
      await onStart(validation.riskLimits);
    } catch {
      setError('Paper deployment could not start. Check approval and risk limits.');
    } finally {
      setStarting(false);
    }
  };

  if (!isDynamicDeploymentEligible(revision)) {
    return (
      <main className="live-review page-container" aria-labelledby="paper-upgrade-title">
        <header className="live-review-header">
          <div><p className="eyebrow">PAPER EXECUTION REVIEW</p><h1 id="paper-upgrade-title">Upgrade required for Paper</h1></div>
          <Button size="base" type="button" variant="secondary" onClick={onCancel}>Back to bot</Button>
        </header>
        <LayerCard className="live-review-section deployment-upgrade-card">
          <h2>Strategy 2.0 dynamic scope required</h2>
          <DeploymentScopeSummary dex={bot.dex} revision={revision} freshness="Universe data freshness is unavailable for this legacy revision." />
          <p>Create and approve a Strategy 2.0 dynamic-market revision in Chat before reviewing Paper deployment.</p>
        </LayerCard>
      </main>
    );
  }

  return (
    <main className="live-review page-container" aria-labelledby="paper-review-title">
      <header className="live-review-header">
        <div>
          <p className="eyebrow">PAPER EXECUTION REVIEW</p>
          <h1 id="paper-review-title">Review Paper deployment</h1>
          <p>Review the strategy scope and shared portfolio limits before starting the local simulation.</p>
        </div>
      </header>
      {error === null ? null : <Banner variant="error" title="Paper review unavailable" description={error} />}
      <div className="live-review-grid paper-review-grid">
        <div className="live-review-main">
          <LayerCard className="live-review-section">
            <p className="eyebrow">1 · STRATEGY AND SCOPE</p>
            <h2>{revision.name} · v{revision.version}</h2>
            <DeploymentScopeSummary dex={bot.dex} revision={revision} freshness="Universe data freshness is unavailable before Paper starts." />
            <dl className="live-definition-list">
              <div><dt>Bot</dt><dd>{bot.name}</dd></div>
              <div><dt>Execution</dt><dd>Local Paper simulation</dd></div>
              <div><dt>Approval</dt><dd>{revision.status === 'approved' ? 'Approved revision' : 'Not approved'}</dd></div>
            </dl>
          </LayerCard>
        </div>
        <aside className="live-review-side">
          <LayerCard className="live-confirm-card paper-risk-card">
            <p className="eyebrow">2 · SHARED RISK LIMITS</p>
            <h2>Portfolio boundaries</h2>
            <p>These limits apply across every market evaluated by this deployment.</p>
            <div className="paper-risk-form">
              <Input size="base" type="number" min="0" step="any" id="paper-max-order" label="Max order (USD)" value={form.maxOrderUsd} error={validation.fieldErrors.maxOrderUsd} onChange={(event) => update('maxOrderUsd', event.currentTarget.value)} disabled={starting} />
              <Input size="base" type="number" min="0" step="any" id="paper-max-position" label="Max position (USD)" value={form.maxPositionUsd} error={validation.fieldErrors.maxPositionUsd} onChange={(event) => update('maxPositionUsd', event.currentTarget.value)} disabled={starting} />
              <Input size="base" type="number" min="0" step="any" id="paper-max-total-exposure" label="Max total exposure (USD)" value={form.maxTotalExposureUsd} error={validation.fieldErrors.maxTotalExposureUsd} onChange={(event) => update('maxTotalExposureUsd', event.currentTarget.value)} disabled={starting} />
              <Input size="base" type="number" min="1" max="50" step="1" id="paper-max-leverage" label="Max leverage" value={form.maxLeverage} error={validation.fieldErrors.maxLeverage} onChange={(event) => update('maxLeverage', event.currentTarget.value)} disabled={starting} />
              <Input size="base" type="number" min="0" step="any" id="paper-max-daily-loss" label="Max daily loss (USD)" value={form.maxDailyLossUsd} error={validation.fieldErrors.maxDailyLossUsd} onChange={(event) => update('maxDailyLossUsd', event.currentTarget.value)} disabled={starting} />
              <Input size="base" type="number" min="0" max="100" step="any" id="paper-max-drawdown" label="Max drawdown (%)" value={form.maxDrawdownPercent} error={validation.fieldErrors.maxDrawdownPercent} onChange={(event) => update('maxDrawdownPercent', event.currentTarget.value)} disabled={starting} />
              <Select<RiskForm['allowedSides']> size="base" label="Allowed sides" value={form.allowedSides} onValueChange={(value) => { if (value !== null) update('allowedSides', value); }} disabled={starting}>
                <Select.Option value="both">Long and short</Select.Option>
                <Select.Option value="long">Long only</Select.Option>
                <Select.Option value="short">Short only</Select.Option>
              </Select>
              <Input size="base" type="number" min="1" max="600" step="1" id="paper-order-rate" label="Max orders per minute" value={form.maxOrdersPerMinute} error={validation.fieldErrors.maxOrdersPerMinute} onChange={(event) => update('maxOrdersPerMinute', event.currentTarget.value)} disabled={starting} />
            </div>
            {validation.riskLimits === null ? <p className="paper-risk-error" role="alert">Review the highlighted risk limits before starting Paper.</p> : null}
            <div className="live-confirm-actions">
              <Button size="base" type="button" variant="secondary" disabled={starting} onClick={onCancel}>Cancel</Button>
              <Button size="base" type="button" variant="primary" disabled={validation.riskLimits === null} loading={starting} onClick={() => void start()}>Start Paper</Button>
            </div>
          </LayerCard>
        </aside>
      </div>
    </main>
  );
}

function toForm(limits: RiskLimits): RiskForm {
  return {
    maxOrderUsd: limits.maxOrderUsd,
    maxPositionUsd: limits.maxPositionUsd,
    maxTotalExposureUsd: limits.maxTotalExposureUsd,
    maxLeverage: String(limits.maxLeverage),
    maxDailyLossUsd: limits.maxDailyLossUsd,
    maxDrawdownPercent: String(limits.maxDrawdownPercent),
    allowedSides: limits.allowedSides.length === 2 ? 'both' : limits.allowedSides[0] ?? 'both',
    maxOrdersPerMinute: String(limits.maxOrdersPerMinute),
  };
}

function validate(form: RiskForm): Readonly<{
  riskLimits: RiskLimits | null;
  fieldErrors: Partial<Record<keyof RiskForm, string>>;
}> {
  const parsed = RiskLimitsSchema.safeParse({
    maxOrderUsd: form.maxOrderUsd,
    maxPositionUsd: form.maxPositionUsd,
    maxTotalExposureUsd: form.maxTotalExposureUsd,
    maxLeverage: Number(form.maxLeverage),
    maxDailyLossUsd: form.maxDailyLossUsd,
    maxDrawdownPercent: Number(form.maxDrawdownPercent),
    allowedSides: form.allowedSides === 'both' ? ['long', 'short'] : [form.allowedSides],
    maxOrdersPerMinute: Number(form.maxOrdersPerMinute),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof RiskForm, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in riskFieldMessages && fieldErrors[field as keyof RiskForm] === undefined) {
        fieldErrors[field as keyof RiskForm] = riskFieldMessages[field as keyof typeof riskFieldMessages];
      }
    }
    return { riskLimits: null, fieldErrors };
  }
  if (Number(parsed.data.maxPositionUsd) < Number(parsed.data.maxOrderUsd)) {
    return { riskLimits: null, fieldErrors: { maxPositionUsd: 'Max position must be at least the max order.' } };
  }
  if (Number(parsed.data.maxTotalExposureUsd) < Number(parsed.data.maxPositionUsd)) {
    return { riskLimits: null, fieldErrors: { maxTotalExposureUsd: 'Max total exposure must be at least the max position.' } };
  }
  return { riskLimits: parsed.data, fieldErrors: {} };
}

const positiveAmountError = 'Enter a positive decimal amount without separators.';
const riskFieldMessages = {
  maxOrderUsd: positiveAmountError,
  maxPositionUsd: positiveAmountError,
  maxTotalExposureUsd: positiveAmountError,
  maxLeverage: 'Max leverage must be a whole number from 1 to 50.',
  maxDailyLossUsd: positiveAmountError,
  maxDrawdownPercent: 'Max drawdown must be greater than 0 and at most 100.',
  allowedSides: 'Choose at least one allowed side.',
  maxOrdersPerMinute: 'Order rate must be a whole number from 1 to 600.',
} as const;
