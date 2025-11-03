import { contextBridge, ipcRenderer } from 'electron';
import type {
  AetherAutomationEvent,
  AetherAutomationRun,
  AutomationApprovalRequest,
  AutomationCancelRequest,
  AutomationStepResultPayload,
  StartAutomationRequest,
} from './shared/aether';
import type { PassGuardUserOverride } from './renderer/types/tab';

type AdblockerBlockedEntry = {
  id: string;
  url: string;
  hostname: string;
  type: string;
  tabId?: number;
  filter?: string;
  timestamp: number;
};

type AdblockerState = {
  enabled: boolean;
  customCosmeticFilters: string[];
  totalBlocked: number;
  recentBlocked: AdblockerBlockedEntry[];
};

let adblockSubscriptionCount = 0;

const ensureAdblockSubscription = () => {
  if (adblockSubscriptionCount === 0) {
    ipcRenderer.send('adblocker:subscribe');
  }
  adblockSubscriptionCount += 1;
};

const releaseAdblockSubscription = () => {
  adblockSubscriptionCount = Math.max(0, adblockSubscriptionCount - 1);
  if (adblockSubscriptionCount === 0) {
    ipcRenderer.send('adblocker:unsubscribe');
  }
};

const api = {
  onAppAction: (handler: (payload: { action: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { action: string }) => {
      handler(payload);
    };
    ipcRenderer.on('app-action', listener);
    return () => {
      ipcRenderer.removeListener('app-action', listener);
    };
  },
  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  openProfileWindow: (profileId: string) => ipcRenderer.invoke('open-profile-window', profileId),
  requestTabContextMenu: (payload: {
    tabId: string;
    isPinned?: boolean;
    position: { x: number; y: number };
  }) => ipcRenderer.invoke('show-tab-context-menu', payload),
  getHomePageUrl: () => ipcRenderer.invoke('get-home-page-url') as Promise<string>,
  onTabAction: (handler: (payload: { action: string; tabId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { action: string; tabId: string }) => {
      handler(payload);
    };
    ipcRenderer.on('tab-action', listener);
    return () => {
      ipcRenderer.removeListener('tab-action', listener);
    };
  },
  settings: {
    getApiKey: () => ipcRenderer.invoke('settings:get-api-key') as Promise<string | null>,
    setApiKey: (key: string | null) => ipcRenderer.invoke('settings:set-api-key', { key }),
  },
  ai: {
    sendPrompt: (payload: {
      prompt: string;
      tabId: string | null;
      tabContext?: {
        url?: string;
        title?: string;
        selectedText?: string;
      };
    }) =>
      ipcRenderer.invoke('ai:send-prompt', payload) as Promise<{
        success: boolean;
        output?: string;
        error?: string;
      }>,
    automation: {
      startRun: (payload: StartAutomationRequest) =>
        ipcRenderer.invoke('aether:start-run', payload) as Promise<{
          success: boolean;
          run?: AetherAutomationRun;
          error?: string;
        }>,
      submitApproval: (payload: AutomationApprovalRequest) =>
        ipcRenderer.invoke('aether:submit-approval', payload) as Promise<{
          success: boolean;
          error?: string;
        }>,
      cancelRun: (payload: AutomationCancelRequest) =>
        ipcRenderer.invoke('aether:cancel-run', payload) as Promise<{
          success: boolean;
          error?: string;
        }>,
      onEvent: (handler: (event: AetherAutomationEvent) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: AetherAutomationEvent) => {
          handler(payload);
        };
        ipcRenderer.on('aether:event', listener);
        return () => {
          ipcRenderer.removeListener('aether:event', listener);
        };
      },
      reportStepResult: (payload: AutomationStepResultPayload) =>
        ipcRenderer.invoke('aether:step-result', payload) as Promise<{
          success: boolean;
          error?: string;
        }>,
    },
  },
  passGuard: {
    updateState: (payload: {
      tabId: string;
      webContentsId: number | null;
      active: boolean;
      userAgent: string;
      source: 'auto' | 'manual';
      reason?: string;
      userOverride?: PassGuardUserOverride;
    }) => ipcRenderer.invoke('passguard:update', payload) as Promise<void>,
  },
  adblocker: {
    getState: () => ipcRenderer.invoke('adblocker:get-state') as Promise<AdblockerState>,
    setEnabled: (payload: { enabled: boolean }) =>
      ipcRenderer.invoke('adblocker:set-enabled', payload) as Promise<AdblockerState>,
    addCosmeticFilter: (payload: { rule: string }) =>
      ipcRenderer.invoke('adblocker:add-cosmetic-filter', payload) as Promise<{
        success: boolean;
        error?: string;
        state?: AdblockerState;
      }>,
    removeCosmeticFilter: (payload: { rule: string }) =>
      ipcRenderer.invoke('adblocker:remove-cosmetic-filter', payload) as Promise<{
        success: boolean;
        error?: string;
        state?: AdblockerState;
      }>,
    clearLog: () => ipcRenderer.invoke('adblocker:clear-log') as Promise<AdblockerState>,
    onBlocked: (handler: (payload: { entry: AdblockerBlockedEntry; totalBlocked: number }) => void) => {
      ensureAdblockSubscription();
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { entry: AdblockerBlockedEntry; totalBlocked: number },
      ) => {
        handler(payload);
      };
      ipcRenderer.on('adblocker:blocked', listener);
      return () => {
        ipcRenderer.removeListener('adblocker:blocked', listener);
        releaseAdblockSubscription();
      };
    },
    onStateChange: (handler: (state: AdblockerState) => void) => {
      ensureAdblockSubscription();
      const listener = (_event: Electron.IpcRendererEvent, payload: AdblockerState) => {
        handler(payload);
      };
      ipcRenderer.on('adblocker:state-changed', listener);
      return () => {
        ipcRenderer.removeListener('adblocker:state-changed', listener);
        releaseAdblockSubscription();
      };
    },
  },
  extensions: {
    load: (extensionPath: string) =>
      ipcRenderer.invoke('extensions:load', extensionPath) as Promise<{
        success: boolean;
        extension?: { id: string; name: string; version: number };
        error?: string;
      }>,
    unload: (extensionId: string) =>
      ipcRenderer.invoke('extensions:unload', extensionId) as Promise<{
        success: boolean;
        error?: string;
      }>,
    list: () =>
      ipcRenderer.invoke('extensions:list') as Promise<{
        success: boolean;
        extensions?: Array<{ id: string; name: string; version: number; path: string }>;
        error?: string;
      }>,
    addTab: (webContentsId: number) =>
      ipcRenderer.invoke('extensions:add-tab', { webContentsId }) as Promise<void>,
    selectTab: (webContentsId: number) =>
      ipcRenderer.invoke('extensions:select-tab', { webContentsId }) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('sylph', api);
