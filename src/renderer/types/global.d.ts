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
      };
    };
  }
}
import type {
  AetherAutomationEvent,
  AetherAutomationRun,
  AutomationApprovalRequest,
  AutomationCancelRequest,
  AutomationStepResultPayload,
  StartAutomationRequest,
} from '../../shared/aether';
import type { PassGuardUserOverride } from './tab';
