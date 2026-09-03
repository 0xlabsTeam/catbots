import type { CatbotsDesktopApi } from '@catbots/contracts';

declare global {
  interface Window {
    catbots: CatbotsDesktopApi;
  }
}

export {};
