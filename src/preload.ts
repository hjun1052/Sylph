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
  onWebviewAction: (handler: (payload: { url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { url: string }) => {
      handler(payload);
    };
    ipcRenderer.on('webview:open-link-in-new-tab', listener);
    return () => {
      ipcRenderer.removeListener('webview:open-link-in-new-tab', listener);
    };
  },
  onWebviewContextMenuAction: (handler: (payload: { action: string; webContentsId: number; url?: string; selection?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { action: string; webContentsId: number; url?: string; selection?: string }) => {
      handler(payload);
    };
    ipcRenderer.on('webview:context-menu-action', listener);
    return () => {
      ipcRenderer.removeListener('webview:context-menu-action', listener);
    };
  },
  showWebviewContextMenu: (payload: {
    params: Electron.ContextMenuParams;
    webContentsId: number;
    tabId: string;
  }) => ipcRenderer.invoke('webview:show-context-menu', payload) as Promise<void>,
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
    installFromStore: (extensionId: string) =>
      ipcRenderer.invoke('extensions:install-from-store', extensionId) as Promise<{
        success: boolean;
        extension?: { id: string; name: string; version: string };
        error?: string;
      }>,
    uninstallFromStore: (extensionId: string) =>
      ipcRenderer.invoke('extensions:uninstall-from-store', extensionId) as Promise<{
        success: boolean;
        error?: string;
      }>,
    updateAll: () =>
      ipcRenderer.invoke('extensions:update-all') as Promise<{
        success: boolean;
        error?: string;
      }>,
    showPopup: async (extensionId: string) => {
      try {
        return await ipcRenderer.invoke('extensions:show-popup', extensionId);
      } catch (error) {
        console.warn('[extensions] Failed to show popup', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
  content: {
    captureScreenshot: (payload: { webContentsId: number; format?: 'png' | 'jpeg' }) =>
      ipcRenderer.invoke('content:capture-screenshot', payload) as Promise<{
        success: boolean;
        dataUrl?: string;
        error?: string;
      }>,
    savePage: (payload: { webContentsId: number }) =>
      ipcRenderer.invoke('content:save-page', payload) as Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>,
    print: (payload: { webContentsId: number }) =>
      ipcRenderer.invoke('content:print', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    toggleFullscreen: (payload: { webContentsId: number }) =>
      ipcRenderer.invoke('content:toggle-fullscreen', payload) as Promise<{
        success: boolean;
        isFullscreen: boolean;
      }>,
    summarizePage: (payload: { webContentsId: number; url: string }) =>
      ipcRenderer.invoke('content:summarize-page', payload) as Promise<{
        success: boolean;
        summary?: string;
        error?: string;
      }>,
    translatePage: (payload: { webContentsId: number; url: string; targetLang?: string }) =>
      ipcRenderer.invoke('content:translate-page', payload) as Promise<{
        success: boolean;
        translation?: string;
        error?: string;
      }>,
    summarizeSelection: (payload: { text: string }) =>
      ipcRenderer.invoke('content:summarize-selection', payload) as Promise<{
        success: boolean;
        summary?: string;
        error?: string;
      }>,
    translateSelection: (payload: { text: string; targetLang?: string }) =>
      ipcRenderer.invoke('content:translate-selection', payload) as Promise<{
        success: boolean;
        translation?: string;
        error?: string;
      }>,
    summarizeUrl: (payload: { url: string }) =>
      ipcRenderer.invoke('content:summarize-url', payload) as Promise<{
        success: boolean;
        summary?: string;
        error?: string;
      }>,
  },
  downloads: {
    onDownloadStarted: (handler: (item: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, item: any) => {
        handler(item);
      };
      ipcRenderer.on('download:started', listener);
      return () => {
        ipcRenderer.removeListener('download:started', listener);
      };
    },
    onDownloadProgress: (handler: (item: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, item: any) => {
        handler(item);
      };
      ipcRenderer.on('download:progress', listener);
      return () => {
        ipcRenderer.removeListener('download:progress', listener);
      };
    },
    onDownloadCompleted: (handler: (item: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, item: any) => {
        handler(item);
      };
      ipcRenderer.on('download:completed', listener);
      return () => {
        ipcRenderer.removeListener('download:completed', listener);
      };
    },
    pauseDownload: (payload: { id: string }) =>
      ipcRenderer.invoke('download:pause', payload) as Promise<{ success: boolean }>,
    resumeDownload: (payload: { id: string }) =>
      ipcRenderer.invoke('download:resume', payload) as Promise<{ success: boolean }>,
    cancelDownload: (payload: { id: string }) =>
      ipcRenderer.invoke('download:cancel', payload) as Promise<{ success: boolean }>,
    openDownload: (payload: { path: string }) =>
      ipcRenderer.invoke('download:open', payload) as Promise<{ success: boolean }>,
    showInFolder: (payload: { path: string }) =>
      ipcRenderer.invoke('download:show-in-folder', payload) as Promise<{ success: boolean }>,
  },
  flowpass: {
    initialize: (profileId: string) =>
      ipcRenderer.invoke('flowpass:initialize', profileId) as Promise<{
        success: boolean;
        hasVault?: boolean;
        isConfigured?: boolean;
        error?: string;
      }>,
    setup: (payload: { profileId: string; masterPassword: string }) =>
      ipcRenderer.invoke('flowpass:setup', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    unlock: (payload: { profileId: string; masterPassword: string }) =>
      ipcRenderer.invoke('flowpass:unlock', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    lock: () =>
      ipcRenderer.invoke('flowpass:lock') as Promise<{
        success: boolean;
        error?: string;
      }>,
    getStatus: () =>
      ipcRenderer.invoke('flowpass:get-status') as Promise<{
        success: boolean;
        status?: 'locked' | 'unlocking' | 'unlocked';
        error?: string;
      }>,
    getConfig: () =>
      ipcRenderer.invoke('flowpass:get-config') as Promise<{
        success: boolean;
        config?: any;
        error?: string;
      }>,
    updateConfig: (payload: { profileId: string; updates: any }) =>
      ipcRenderer.invoke('flowpass:update-config', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    getEntries: () =>
      ipcRenderer.invoke('flowpass:get-entries') as Promise<{
        success: boolean;
        entries?: any[];
        error?: string;
      }>,
    getEntry: (entryId: string) =>
      ipcRenderer.invoke('flowpass:get-entry', entryId) as Promise<{
        success: boolean;
        entry?: any;
        error?: string;
      }>,
    saveEntry: (payload: { profileId: string; entry: any; masterPassword: string }) =>
      ipcRenderer.invoke('flowpass:save-entry', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    deleteEntry: (payload: { profileId: string; entryId: string; masterPassword: string }) =>
      ipcRenderer.invoke('flowpass:delete-entry', payload) as Promise<{
        success: boolean;
        deleted?: boolean;
        error?: string;
      }>,
    getMatches: (hostname: string) =>
      ipcRenderer.invoke('flowpass:get-matches', hostname) as Promise<{
        success: boolean;
        matches?: Array<{
          entryId: string;
          name: string;
          username: string;
          lastUsedAt: number;
        }>;
        error?: string;
      }>,
    getCredentials: (entryId: string) =>
      ipcRenderer.invoke('flowpass:get-credentials', entryId) as Promise<{
        success: boolean;
        credentials?: { username: string; password: string } | null;
        error?: string;
      }>,
    captureLogin: (payload: { host: string; url: string; username: string; password: string }) =>
      ipcRenderer.invoke('flowpass:capture-login', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    getCapturedLogins: () =>
      ipcRenderer.invoke('flowpass:get-captured-logins') as Promise<{
        success: boolean;
        captures?: Array<{
          host: string;
          url: string;
          username: string;
          password: string;
          timestamp: number;
        }>;
        error?: string;
      }>,
    clearCaptureBuffer: () =>
      ipcRenderer.invoke('flowpass:clear-capture-buffer') as Promise<{
        success: boolean;
        error?: string;
      }>,
    addNeverSaveHost: (hostname: string) =>
      ipcRenderer.invoke('flowpass:add-never-save-host', hostname) as Promise<{
        success: boolean;
        error?: string;
      }>,
    removeNeverSaveHost: (hostname: string) =>
      ipcRenderer.invoke('flowpass:remove-never-save-host', hostname) as Promise<{
        success: boolean;
        removed?: boolean;
        error?: string;
      }>,
    changeMasterPassword: (payload: { profileId: string; currentPassword: string; newPassword: string }) =>
      ipcRenderer.invoke('flowpass:change-master-password', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
    exportEncrypted: (profileId: string) =>
      ipcRenderer.invoke('flowpass:export-encrypted', profileId) as Promise<{
        success: boolean;
        data?: string;
        error?: string;
      }>,
    importEntries: (payload: { profileId: string; entries: any[]; masterPassword: string }) =>
      ipcRenderer.invoke('flowpass:import-entries', payload) as Promise<{
        success: boolean;
        error?: string;
      }>,
  },
};

contextBridge.exposeInMainWorld('sylph', api);
