import { Badge, Button, Dialog, Select } from '@cloudflare/kumo';
import { ArrowLeftIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { WorkbenchState } from '@catbots/contracts';
import { legacyMarketHint } from '../../legacy-contract-compat';

export type WorkbenchHeaderProps = Readonly<{
  state: WorkbenchState;
  approving: boolean;
  onBack(): void;
  onSelectVersion(version: number): void;
  onApprove(): Promise<void>;
}>;

export function WorkbenchHeader({ state, approving, onBack, onSelectVersion, onApprove }: WorkbenchHeaderProps) {
  const revision = state.currentRevision;
  return (
    <header className="workbench-header">
      <Button type="button" variant="ghost" size="sm" icon={ArrowLeftIcon} onClick={onBack}>All bots</Button>
      <div className="workbench-title">
        <div>
          <p className="eyebrow">AI BOT WORKBENCH</p>
          <h1 id="bot-workbench-title">{state.bot.name}</h1>
        </div>
        <Badge variant="secondary">{legacyMarketHint(state.bot)}</Badge>
        <Badge variant={revision?.status === 'approved' ? 'success' : 'info'}>{revision?.status === 'approved' ? 'Approved' : 'Draft'}</Badge>
      </div>
      <div className="workbench-header-actions">
        {revision === null ? null : (
          <Select<string>
            label="Strategy version"
            value={String(revision.version)}
            onValueChange={(value) => onSelectVersion(Number(value))}
          >
            {state.revisions.map((candidate) => (
              <Select.Option key={candidate.version} value={String(candidate.version)}>v{candidate.version} · {candidate.status}</Select.Option>
            ))}
          </Select>
        )}
        {revision === null || revision.status === 'approved' ? null : (
          <Dialog.Root>
            <Dialog.Trigger render={(props) => <Button {...props} type="button" variant="primary" icon={CheckCircleIcon} disabled={approving}>Approve v{revision.version}</Button>} />
            <Dialog className="workbench-approval-dialog">
              <Dialog.Title>Approve strategy v{revision.version}?</Dialog.Title>
              <Dialog.Description>This locks your approval to this exact revision. It does not start Paper or Live trading.</Dialog.Description>
              <div className="workbench-dialog-actions">
                <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Cancel</Button>} />
                <Dialog.Close render={(props) => <Button {...props} type="button" variant="primary" loading={approving} onClick={() => void onApprove()}>Confirm approval</Button>} />
              </div>
            </Dialog>
          </Dialog.Root>
        )}
      </div>
    </header>
  );
}
