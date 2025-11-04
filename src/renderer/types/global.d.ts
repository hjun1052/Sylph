export {};

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

declare global {
  interface Window {
    sylph?: {
      onAppAction: (handler: (payload: { action: string }) => void) => () => void;
      onTabAction: (handler: (payload: { action: string; tabId: string }) => void) => () => void;
      onWebviewAction: (handler: (payload: { url: string }) => void) => () => void;
      onWebviewContextMenuAction: (handler: (payload: { action: string; webContentsId: number; url?: string }) => void) => () => void;
      showWebviewContextMenu: (payload: {
        params: Electron.ContextMenuParams;
        webContentsId: number;
        tabId: string;
      }) => Promise<void>;
      requestTabContextMenu: (payload: {
        tabId: string;
        isPinned?: boolean;
        url?: string;
        position: { x: number; y: number };
      }) => Promise<void>;
      getHomePageUrl: () => Promise<string>;
      openSettingsWindow: () => Promise<void>;
      openProfileWindow: (profileId: string) => Promise<void>;
      settings: {
        getApiKey: () => Promise<string | null>;
        setApiKey: (key: string | null) => Promise<void>;
      };
      ai: {
        sendPrompt: (payload: {
          prompt: string;
          tabId: string | null;
          tabContext?: {
            url?: string;
            title?: string;
            selectedText?: string;
          };
        }) => Promise<{
          success: boolean;
          output?: string;
          error?: string;
        }>;
        automation: {
          startRun: (payload: StartAutomationRequest) => Promise<{
            success: boolean;
            run?: AetherAutomationRun;
            error?: string;
          }>;
          submitApproval: (payload: AutomationApprovalRequest) => Promise<{
            success: boolean;
            error?: string;
          }>;
          cancelRun: (payload: AutomationCancelRequest) => Promise<{
            success: boolean;
            error?: string;
          }>;
          onEvent: (handler: (event: AetherAutomationEvent) => void) => () => void;
          reportStepResult: (payload: AutomationStepResultPayload) => Promise<{
            success: boolean;
            error?: string;
          }>;
        };
      };
      passGuard?: {
        updateState: (payload: {
          tabId: string;
          webContentsId: number | null;
          active: boolean;
          userAgent: string;
          source: 'auto' | 'manual';
          reason?: string;
          userOverride?: PassGuardUserOverride;
        }) => Promise<void> | void;
      };
      adblocker?: {
        getState: () => Promise<AdblockerState>;
        setEnabled: (payload: { enabled: boolean }) => Promise<AdblockerState>;
        addCosmeticFilter: (payload: { rule: string }) => Promise<{
          success: boolean;
          error?: string;
          state?: AdblockerState;
        }>;
        removeCosmeticFilter: (payload: { rule: string }) => Promise<{
          success: boolean;
          error?: string;
          state?: AdblockerState;
        }>;
        clearLog: () => Promise<AdblockerState>;
        onBlocked: (handler: (payload: { entry: AdblockerBlockedEntry; totalBlocked: number }) => void) => () => void;
        onStateChange: (handler: (state: AdblockerState) => void) => () => void;
      };
      extensions?: {
        load: (extensionPath: string) => Promise<{
          success: boolean;
          extension?: { id: string; name: string; version: number };
          error?: string;
        }>;
        unload: (extensionId: string) => Promise<{
          success: boolean;
          error?: string;
        }>;
        list: () => Promise<{
          success: boolean;
          extensions?: Array<{ id: string; name: string; version: number; path: string }>;
          error?: string;
        }>;
        addTab: (webContentsId: number) => Promise<void>;
        selectTab: (webContentsId: number) => Promise<void>;
        installFromStore: (extensionId: string) => Promise<{
          success: boolean;
          extension?: { id: string; name: string; version: string };
          error?: string;
        }>;
        uninstallFromStore: (extensionId: string) => Promise<{
          success: boolean;
          error?: string;
        }>;
        updateAll: () => Promise<{
          success: boolean;
          error?: string;
        }>;
        showPopup: (extensionId: string) => Promise<{
          success: boolean;
          error?: string;
        }>;
      };
      content?: {
        captureScreenshot: (payload: { webContentsId: number; format?: 'png' | 'jpeg' }) => Promise<{
          success: boolean;
          dataUrl?: string;
          error?: string;
        }>;
        savePage: (payload: { webContentsId: number }) => Promise<{
          success: boolean;
          path?: string;
          error?: string;
        }>;
        print: (payload: { webContentsId: number }) => Promise<{
          success: boolean;
          error?: string;
        }>;
        toggleFullscreen: (payload: { webContentsId: number }) => Promise<{
          success: boolean;
          isFullscreen: boolean;
        }>;
        summarizePage: (payload: { webContentsId: number; url: string }) => Promise<{
          success: boolean;
          summary?: string;
          error?: string;
        }>;
        translatePage: (payload: { webContentsId: number; url: string; targetLang?: string }) => Promise<{
          success: boolean;
          translation?: string;
          error?: string;
        }>;
        summarizeUrl: (payload: { url: string }) => Promise<{
          success: boolean;
          summary?: string;
          error?: string;
        }>;
      };
      downloads?: {
        onDownloadStarted: (handler: (item: DownloadItemInfo) => void) => () => void;
        onDownloadProgress: (handler: (item: DownloadItemInfo) => void) => () => void;
        onDownloadCompleted: (handler: (item: DownloadItemInfo) => void) => () => void;
        pauseDownload: (payload: { id: string }) => Promise<{ success: boolean }>;
        resumeDownload: (payload: { id: string }) => Promise<{ success: boolean }>;
        cancelDownload: (payload: { id: string }) => Promise<{ success: boolean }>;
        openDownload: (payload: { path: string }) => Promise<{ success: boolean }>;
        showInFolder: (payload: { path: string }) => Promise<{ success: boolean }>;
      };
    };
  }
}

type DownloadItemInfo = {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  isPaused: boolean;
  canResume: boolean;
  mimeType?: string;
};
import type {
  AetherAutomationEvent,
  AetherAutomationRun,
  AutomationApprovalRequest,
  AutomationCancelRequest,
  AutomationStepResultPayload,
  StartAutomationRequest,
} from '../../shared/aether';
import type { PassGuardUserOverride } from './tab';
