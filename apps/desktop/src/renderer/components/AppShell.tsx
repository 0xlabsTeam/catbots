import type { ReactNode } from 'react';
import { Button } from '@cloudflare/kumo';
import { ActivityIcon, ChartLineUpIcon, DatabaseIcon, GearSixIcon, RobotIcon } from '@phosphor-icons/react';

export const appDestinations = ['bots', 'data', 'activity', 'settings'] as const;
export type AppDestination = (typeof appDestinations)[number];

type AppShellProps = {
  destination: AppDestination;
  onNavigate(destination: AppDestination): void;
  children: ReactNode;
};

const navigationItems: ReadonlyArray<{ destination: AppDestination; label: string; icon: typeof RobotIcon }> = [
  { destination: 'bots', label: 'Bots', icon: RobotIcon },
  { destination: 'data', label: 'Data', icon: DatabaseIcon },
  { destination: 'activity', label: 'Activity', icon: ActivityIcon },
  { destination: 'settings', label: 'Settings', icon: GearSixIcon },
];

export function AppShell({ destination, onNavigate, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand" aria-label="Catbots local workspace">
          <span className="app-brand-mark" aria-hidden="true"><RobotIcon weight="duotone" /></span>
          <span>Catbots</span>
        </div>
        <nav className="app-navigation" aria-label="Global navigation">
          {navigationItems.map(({ destination: itemDestination, label, icon }) => (
            <Button
              key={itemDestination}
              type="button"
              variant={destination === itemDestination ? 'secondary' : 'ghost'}
              className="app-navigation-item"
              aria-current={destination === itemDestination ? 'page' : undefined}
              onClick={() => onNavigate(itemDestination)}
              icon={icon}
              title={label}
            >
              {label}
            </Button>
          ))}
        </nav>
        <p className="app-sidebar-note"><ChartLineUpIcon aria-hidden="true" /> Local workspace</p>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
