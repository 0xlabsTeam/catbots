import { Banner } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';

export type ConnectionTestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success'; model: string }
  | { state: 'error'; code: string }
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
  return <Banner className="connection-status" variant="error" role="alert" icon={<WarningCircleIcon aria-hidden="true" weight="fill" />} title="Connection test failed" description={errorDescription(value.code)} />;
}

function errorDescription(code: string): string {
  if (code === 'LLM_CONNECTION_TEST_UNAVAILABLE') return 'Connection testing is unavailable in this Catbots version.';
  if (code === 'TEST_REQUIRED') return 'Test this provider again before saving changed values.';
  if (code === 'SAVE_FAILED') return 'Settings could not be saved. Review the local values and try again.';
  return 'We could not verify this provider. Review the values and try again.';
}
