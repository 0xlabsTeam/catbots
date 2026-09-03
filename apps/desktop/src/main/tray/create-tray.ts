import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { RuntimeStatusSchema, type RuntimeStatus } from '@catbots/contracts';

export type CreateTrayOptions = {
  iconPath: string;
  showWindow: () => void | Promise<void>;
  quit: () => void | Promise<void>;
  getRuntimeStatus: () => RuntimeStatus;
  subscribeRuntimeStatus: (listener: (status: RuntimeStatus) => void) => () => void;
};

export type TrayController = {
  tray: Tray;
  dispose(): void;
};

export function createTray(options: CreateTrayOptions): TrayController {
  const icon = nativeImage.createFromPath(options.iconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  let disposed = false;
  const renderStatus = (candidate: unknown) => {
    if (disposed) return;
    const status = sanitizeStatus(candidate);
    tray.setToolTip(formatStatus(status));
    tray.setContextMenu(Menu.buildFromTemplate(buildMenu(options, status)));
  };
  renderStatus(readStatus(options.getRuntimeStatus));

  let unsubscribe: () => void = () => undefined;
  try {
    const candidate = options.subscribeRuntimeStatus(renderStatus);
    if (typeof candidate !== 'function') throw new Error('Invalid runtime status subscription');
    unsubscribe = candidate;
  } catch {
    renderStatus({ state: 'error', activeBots: 0 });
  }

  return {
    tray,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        unsubscribe();
      } finally {
        tray.destroy();
      }
    },
  };
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

function sanitizeStatus(candidate: unknown): RuntimeStatus {
  const result = RuntimeStatusSchema.safeParse(candidate);
  return result.success ? result.data : { state: 'error', activeBots: 0 };
}

function formatStatus(status: RuntimeStatus): string {
  const label = status.state.charAt(0).toUpperCase() + status.state.slice(1);
  const botLabel = status.activeBots === 1 ? 'active bot' : 'active bots';
  return `Runtime: ${label} · ${status.activeBots} ${botLabel}`;
}
