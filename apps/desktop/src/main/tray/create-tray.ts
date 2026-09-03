import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { RuntimeStatus } from '@catbots/contracts';

export type CreateTrayOptions = {
  iconPath: string;
  showWindow: () => void | Promise<void>;
  quit: () => void | Promise<void>;
  getRuntimeStatus: () => RuntimeStatus;
};

export function createTray(options: CreateTrayOptions): Tray {
  const icon = nativeImage.createFromPath(options.iconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  const status = readStatus(options.getRuntimeStatus);
  tray.setToolTip(formatStatus(status));
  tray.setContextMenu(Menu.buildFromTemplate(buildMenu(options, status)));
  return tray;
}

function buildMenu(options: CreateTrayOptions, status: RuntimeStatus): MenuItemConstructorOptions[] {
  return [
    { label: formatStatus(status), enabled: false },
    { type: 'separator' },
    { label: 'Open Catbots', click: () => options.showWindow() },
    { type: 'separator' },
    { label: 'Quit Catbots', click: () => options.quit() },
  ];
}

function readStatus(getRuntimeStatus: () => RuntimeStatus): RuntimeStatus {
  try {
    return getRuntimeStatus();
  } catch {
    return { state: 'error', activeBots: 0 };
  }
}

function formatStatus(status: RuntimeStatus): string {
  const label = status.state.charAt(0).toUpperCase() + status.state.slice(1);
  const botLabel = status.activeBots === 1 ? 'active bot' : 'active bots';
  return `Runtime: ${label} · ${status.activeBots} ${botLabel}`;
}
