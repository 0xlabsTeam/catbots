import { Banner } from '@cloudflare/kumo';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';

export type ConnectionTestErrorCode = 'connection-unavailable' | 'test-required' | 'save-failed' | 'connection-failed';

export type ConnectionTestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success'; model: string }
  | { state: 'error'; code: ConnectionTestErrorCode }
  | { state: 'saved' };

/** Converts dependency-owned result codes into the closed renderer status vocabulary. */
export function mapExternalConnectionErrorCode(code: string): ConnectionTestErrorCode {
  return code === 'LLM_CONNECTION_TEST_UNAVAILABLE' ? 'connection-unavailable' : 'connection-failed';
}

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

function errorDescription(code: ConnectionTestErrorCode): string {
  if (code === 'connection-unavailable') return 'Connection testing is unavailable in this Catbots version.';
  if (code === 'test-required') return 'Test this provider again before saving changed values.';
  if (code === 'save-failed') return 'Settings could not be saved. Review the local values and try again.';
  return 'We could not verify this provider. Review the values and try again.';
}
