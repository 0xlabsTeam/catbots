import { Banner } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';

export type ConnectionTestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success'; model: string }
  | { state: 'error'; message: string }
  | { state: 'saved' };

export function ConnectionTestStatus({ value }: { value: ConnectionTestState }) {
  if (value.state === 'idle') return null;
  if (value.state === 'testing') {
    return <Banner className="connection-status" role="status" aria-live="polite" title="Testing connection" description="Checking this provider with the values in this form." />;
  }
  if (value.state === 'success') {
    return <Banner className="connection-status connection-status-success" role="status" aria-live="polite" icon={<CheckCircleIcon aria-hidden="true" weight="fill" />} title="Connection successful" description={`Ready to use ${value.model}.`} />;
  }
  if (value.state === 'saved') {
    return <Banner className="connection-status connection-status-success" role="status" aria-live="polite" icon={<CheckCircleIcon aria-hidden="true" weight="fill" />} title="Settings saved" description="The local configuration was updated. Enter a key again before another provider change." />;
  }
  return <Banner className="connection-status" variant="error" role="alert" icon={<WarningCircleIcon aria-hidden="true" weight="fill" />} title="Connection test failed" description={value.message} />;
}
