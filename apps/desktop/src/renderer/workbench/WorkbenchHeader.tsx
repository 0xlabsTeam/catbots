import { Badge, Button, Dialog, Select } from '@cloudflare/kumo';
import { ArrowLeftIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { WorkbenchState } from '@catbots/contracts';

export type WorkbenchHeaderProps = Readonly<{
  state: WorkbenchState;
  approving: boolean;
  onBack(): void;
  onSelectVersion(version: number): void;
  onApprove(): Promise<void>;
}>;

export function WorkbenchHeader({ state, approving, onBack, onSelectVersion, onApprove }: WorkbenchHeaderProps) {
  const revision = state.flowDraft ? null : state.currentRevision;
  return (
    <header className="workbench-header">
      <Button type="button" variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={onBack}>All bots</Button>
      <div className="workbench-title">
        <div>
          <h1 id="bot-workbench-title">{state.bot.name}</h1>
          {!state.flowDraft && <p className="workbench-scope-line">{dexName(state.bot.dex)} · {scopeName(revision)}</p>}
        </div>
        {!state.flowDraft && <Badge variant={revision?.status === 'approved' ? 'success' : 'info'}>{revision?.status === 'approved' ? 'Approved' : 'Draft'}</Badge>}
      </div>
      <div className="workbench-header-actions">
        {revision === null ? null : (
          <Select<string> size="sm" aria-label="Strategy version" value={String(revision.version)} onValueChange={(value) => onSelectVersion(Number(value))} items={state.revisions.map((candidate) => ({ value: String(candidate.version), label: `v${candidate.version} · ${candidate.status}` }))}>
            {state.revisions.map((candidate) => <Select.Option key={candidate.version} value={String(candidate.version)}>v{candidate.version} · {candidate.status}</Select.Option>)}
          </Select>
        )}
        {revision === null || revision.status === 'approved' ? null : (
          <Dialog.Root>
            <Dialog.Trigger render={(props) => <Button {...props} type="button" variant="primary" size="sm" icon={CheckCircleIcon} disabled={approving}>Approve v{revision.version}</Button>} />
            <Dialog className="workbench-approval-dialog">
              <Dialog.Title>Approve strategy v{revision.version}?</Dialog.Title>
              <Dialog.Description>This locks your approval to this exact revision. It does not start Paper or Live trading.</Dialog.Description>
              <div className="workbench-dialog-actions">
                <Dialog.Close render={(props) => <Button size="base" {...props} type="button" variant="secondary">Cancel</Button>} />
                <Dialog.Close render={(props) => <Button size="base" {...props} type="button" variant="primary" loading={approving} onClick={() => void onApprove()}>Confirm approval</Button>} />
              </div>
            </Dialog>
          </Dialog.Root>
        )}
      </div>
    </header>
  );
}

function dexName(dex: WorkbenchState['bot']['dex']): string {
  return dex === 'hyperliquid' ? 'Hyperliquid' : dex;
}

function scopeName(revision: WorkbenchState['currentRevision']): string {
  if (revision?.marketScope.type !== 'legacy_fixed') return 'Dynamic markets';
  return revision.marketScope.market === undefined
    ? 'Legacy fixed market unavailable'
    : `Fixed market ${revision.marketScope.market}`;
}
