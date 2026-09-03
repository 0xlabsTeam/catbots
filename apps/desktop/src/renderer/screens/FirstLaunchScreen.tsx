import type { CatbotsDesktopApi, RedactedLocalConfig } from '@catbots/contracts';
import { SettingsScreen } from './SettingsScreen';

type FirstLaunchScreenProps = { api: CatbotsDesktopApi['config']; onSaved?(config: RedactedLocalConfig): void };

export function FirstLaunchScreen({ api, onSaved }: FirstLaunchScreenProps) {
  return <SettingsScreen api={api} onboarding onSaved={onSaved} />;
}
