import { useState, type ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';
import { Button } from '@cloudflare/kumo';
import { ActivityIcon, DesktopIcon, SidebarSimpleIcon, CaretRightIcon, DatabaseIcon, GearSixIcon, RobotIcon } from '@phosphor-icons/react';

export const appDestinations = ['bots', 'nodes', 'data', 'activity', 'settings'] as const;
export type AppDestination = (typeof appDestinations)[number];

type AppShellProps = {
  surface?: 'desktop' | 'web';
  focused?: boolean;
  destination: AppDestination;
  onNavigate(destination: AppDestination): void;
  children: ReactNode;
};

const navigationItems: ReadonlyArray<{ destination: AppDestination; label: string; icon: typeof RobotIcon }> = [
  { destination: 'bots', label: 'Bots', icon: RobotIcon },
  { destination: 'nodes', label: 'Nodes', icon: DatabaseIcon },
  { destination: 'data', label: 'Data', icon: DatabaseIcon },
  { destination: 'activity', label: 'Activity', icon: ActivityIcon },
  { destination: 'settings', label: 'Settings', icon: GearSixIcon },
];

export function AppShell({ destination, onNavigate, children, surface = 'desktop', focused = false }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const currentLabel = navigationItems.find((item) => item.destination === destination)?.label;
  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${focused ? ' workspace-focused' : ''}`}>
      <aside className="app-sidebar">
        <div className="app-brand" aria-label="Catbots local workspace">
          <span className="app-brand-mark" aria-hidden="true"><BrandLogo decorative /></span>
          <span className="app-brand-name">Catbots</span>
        <Button variant="ghost" size="sm" className="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><SidebarSimpleIcon size={18} /></Button>
        </div>
        <p className="sidebar-section-label">Workspace</p>
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
              aria-label={label}
            >
              <span className="navigation-label">{label}</span>
            </Button>
          ))}
        </nav>
        <div className="app-sidebar-note"><DesktopIcon aria-hidden="true" size={18} /><div><strong>Local workspace</strong><span>Stored on this device</span></div></div>
      </aside>
      <div className="app-main"><header className="app-topbar" hidden={focused}><span>Workspace</span><CaretRightIcon size={12} aria-hidden="true" /><strong>{currentLabel}</strong><span className="workspace-mode"><DesktopIcon size={14} aria-hidden="true" /> {surface === 'web' ? 'Browser · Local backend' : 'On device'}</span></header><main className="app-content">{children}</main></div>
    </div>
  );
}
