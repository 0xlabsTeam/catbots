import { useState } from 'react';
import { Banner, Button, Input, LayerCard, Select } from '@cloudflare/kumo';
import type { BotSummary, RiskLimits, StrategyRevision } from '@catbots/contracts';

import { DeploymentScopeSummary } from '../workbench/DeploymentScopeSummary';

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
  const riskLimits = fromForm(form);
  const validationError = validate(riskLimits);

  const update = (field: keyof RiskForm, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const start = async () => {
    if (validationError !== null) return;
    setStarting(true);
    setError(null);
    try {
      await onStart(riskLimits);
    } catch {
      setError('Paper deployment could not start. Check approval and risk limits.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="live-review" aria-labelledby="paper-review-title">
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
            <DeploymentScopeSummary freshness="Universe data freshness is unavailable before Paper starts." />
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
              <Input type="number" min="0" id="paper-max-order" label="Max order (USD)" value={form.maxOrderUsd} onChange={(event) => update('maxOrderUsd', event.currentTarget.value)} disabled={starting} />
              <Input type="number" min="0" id="paper-max-position" label="Max position (USD)" value={form.maxPositionUsd} onChange={(event) => update('maxPositionUsd', event.currentTarget.value)} disabled={starting} />
              <Input type="number" min="0" id="paper-max-total-exposure" label="Max total exposure (USD)" value={form.maxTotalExposureUsd} onChange={(event) => update('maxTotalExposureUsd', event.currentTarget.value)} disabled={starting} />
              <Input type="number" min="0" step="0.1" id="paper-max-leverage" label="Max leverage" value={form.maxLeverage} onChange={(event) => update('maxLeverage', event.currentTarget.value)} disabled={starting} />
              <Input type="number" min="0" id="paper-max-daily-loss" label="Max daily loss (USD)" value={form.maxDailyLossUsd} onChange={(event) => update('maxDailyLossUsd', event.currentTarget.value)} disabled={starting} />
              <Input type="number" min="0" step="0.1" id="paper-max-drawdown" label="Max drawdown (%)" value={form.maxDrawdownPercent} onChange={(event) => update('maxDrawdownPercent', event.currentTarget.value)} disabled={starting} />
              <Select<RiskForm['allowedSides']> label="Allowed sides" value={form.allowedSides} onValueChange={(value) => { if (value !== null) update('allowedSides', value); }} disabled={starting}>
                <Select.Option value="both">Long and short</Select.Option>
                <Select.Option value="long">Long only</Select.Option>
                <Select.Option value="short">Short only</Select.Option>
              </Select>
              <Input type="number" min="1" step="1" id="paper-order-rate" label="Max orders per minute" value={form.maxOrdersPerMinute} onChange={(event) => update('maxOrdersPerMinute', event.currentTarget.value)} disabled={starting} />
            </div>
            {validationError === null ? null : <p className="paper-risk-error" role="alert">{validationError}</p>}
            <div className="live-confirm-actions">
              <Button type="button" variant="secondary" disabled={starting} onClick={onCancel}>Cancel</Button>
              <Button type="button" variant="primary" disabled={validationError !== null} loading={starting} onClick={() => void start()}>Start Paper</Button>
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

function fromForm(form: RiskForm): RiskLimits {
  return {
    maxOrderUsd: form.maxOrderUsd,
    maxPositionUsd: form.maxPositionUsd,
    maxTotalExposureUsd: form.maxTotalExposureUsd,
    maxLeverage: Number(form.maxLeverage),
    maxDailyLossUsd: form.maxDailyLossUsd,
    maxDrawdownPercent: Number(form.maxDrawdownPercent),
    allowedSides: form.allowedSides === 'both' ? ['long', 'short'] : [form.allowedSides],
    maxOrdersPerMinute: Number(form.maxOrdersPerMinute),
  };
}

function validate(limits: RiskLimits): string | null {
  const positive = [limits.maxOrderUsd, limits.maxPositionUsd, limits.maxTotalExposureUsd, limits.maxDailyLossUsd]
    .every((value) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0);
  if (!positive || !Number.isFinite(limits.maxLeverage) || limits.maxLeverage <= 0 || !Number.isFinite(limits.maxDrawdownPercent) || limits.maxDrawdownPercent <= 0 || !Number.isInteger(limits.maxOrdersPerMinute) || limits.maxOrdersPerMinute <= 0) {
    return 'Enter positive values for every risk limit.';
  }
  if (Number(limits.maxPositionUsd) < Number(limits.maxOrderUsd)) return 'Max position must be at least the max order.';
  if (Number(limits.maxTotalExposureUsd) < Number(limits.maxPositionUsd)) return 'Max total exposure must be at least the max position.';
  return null;
}
