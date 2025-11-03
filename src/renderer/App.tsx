const DEFAULT_HOME_URL = 'about:blank';

const DEFAULT_HOME_TITLE = 'Sylph Home';

const MIN_AI_PANEL_WIDTH = 260;
const MAX_AI_PANEL_WIDTH = 520;
const DEFAULT_AI_PANEL_WIDTH = 340;
const AI_PANEL_WIDTH_STORAGE_KEY = 'sylph.aiPanel.width';
const AI_PANEL_COLLAPSED_STORAGE_KEY = 'sylph.aiPanel.collapsed';
const TABS_STORAGE_KEY = 'sylph.tabs.state';
const SPACES_STORAGE_KEY = 'sylph.spaces.state';
const ACTIVE_SPACE_STORAGE_KEY = 'sylph.activeSpace';
const DEFAULT_SPACE_ID = 'space-default';
const DEFAULT_SPACE_NAME = 'Space 1';
const DEFAULT_SPLIT_RATIO = 0.52;
const SPACE_COLOR_PALETTE = ['var(--color-green-400)', '#f472b6', '#60a5fa', '#facc15', '#f97316'];
const clampSplitRatio = (value: number) => Math.min(0.85, Math.max(0.15, value));

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  PageFaviconUpdatedEvent,
  PageTitleUpdatedEvent,
  WebviewTag,
} from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { PassGuardUserOverride, Tab, TabAIContext, TabAIMessage, TabPassGuardState } from './types/tab';
import { HistoryEntry, HistoryDatabase, MAX_HISTORY_ENTRIES, HISTORY_CLEANUP_INTERVAL, HISTORY_STORAGE_KEY } from './types/history';
import { ArchivedTab, ArchiveSettings, DEFAULT_ARCHIVE_SETTINGS, ARCHIVE_STORAGE_KEY, ARCHIVE_SETTINGS_STORAGE_KEY } from './types/archive';
import { Profile, DEFAULT_PROFILE_ID, createDefaultProfile, createIncognitoProfile, PROFILES_STORAGE_KEY } from './types/profile';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type {
  AetherAutomationEvent,
  AetherAutomationRun,
  AetherAutomationStep,
  AutomationCommand,
} from '../shared/aether';
import { DEFAULT_USER_AGENT, PASS_GUARD_USER_AGENT, CHROME_USER_AGENT } from '../shared/network';
import {
  DEFAULT_PASS_GUARD_SETTINGS,
  PASS_GUARD_SETTINGS_STORAGE_KEY,
  detectPassGuardTrigger,
  normalizePassGuardSettings,
  sanitizeHostList,
  type PassGuardSettings,
} from '../shared/passguard';

type Space = {
  id: string;
  name: string;
  color: string;
};

type SplitState = {
  isSplit: boolean;
  primaryTabId: string | null;
  secondaryTabId: string | null;
  ratio: number;
  focus: 'primary' | 'secondary';
};

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

const createDefaultSplitState = (): SplitState => ({
  isSplit: false,
  primaryTabId: null,
  secondaryTabId: null,
  ratio: DEFAULT_SPLIT_RATIO,
  focus: 'primary',
});

const ADBLOCK_PICKER_SCRIPT = String.raw`
(() => {
  const existing = window.__sylphAdblockPicker;
  if (existing && typeof existing.cleanup === 'function') {
    existing.cleanup();
  }
  return new Promise(resolve => {
    let currentElement = document.body;
    let isMouseMode = true;

    const highlight = document.createElement('div');
    highlight.style.position = 'fixed';
    highlight.style.pointerEvents = 'none';
    highlight.style.zIndex = '2147483646';
    highlight.style.border = '2px solid #4fb276';
    highlight.style.background = 'rgba(79, 178, 118, 0.18)';
    highlight.style.borderRadius = '6px';
    highlight.style.transition = 'all 80ms ease-out';

    const label = document.createElement('div');
    label.style.position = 'fixed';
    label.style.pointerEvents = 'none';
    label.style.zIndex = '2147483647';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '4px';
    label.style.background = 'rgba(6, 20, 15, 0.85)';
    label.style.color = '#f4f1ea';
    label.style.fontSize = '12px';
    label.style.fontFamily = 'monospace';
    label.style.transform = 'translate(-50%, -130%)';

    const instructions = document.createElement('div');
    instructions.style.position = 'fixed';
    instructions.style.top = '16px';
    instructions.style.left = '50%';
    instructions.style.transform = 'translateX(-50%)';
    instructions.style.padding = '8px 16px';
    instructions.style.borderRadius = '8px';
    instructions.style.background = 'rgba(6, 20, 15, 0.92)';
    instructions.style.color = '#f4f1ea';
    instructions.style.fontSize = '13px';
    instructions.style.fontFamily = 'system-ui, sans-serif';
    instructions.style.zIndex = '2147483647';
    instructions.style.pointerEvents = 'none';
    instructions.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    instructions.innerHTML = '클릭: 선택 | ↑: 부모 | ↓: 자식 | Esc: 취소';

    const cssEscape = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape
      : (value => value.replace(/[^a-zA-Z0-9_-]/g, match => '\\' + match));

    const getSelector = element => {
      if (!(element instanceof Element)) return null;
      if (element.id) {
        return '#' + cssEscape(element.id);
      }
      const parts = [];
      let el = element;
      while (el && el.nodeType === 1 && el !== document.documentElement) {
        let part = el.nodeName.toLowerCase();
        if (el.id) {
          part += '#' + cssEscape(el.id);
          parts.unshift(part);
          break;
        }
        const classList = Array.from(el.classList).slice(0, 2);
        if (classList.length > 0) {
          part += classList.map(cls => '.' + cssEscape(cls)).join('');
        } else {
          let index = 1;
          let sibling = el;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.nodeName === el.nodeName) index += 1;
          }
          part += ':nth-of-type(' + index + ')';
        }
        parts.unshift(part);
        el = el.parentElement;
      }
      return parts.join(' > ');
    };

    const handleMouseDown = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleMouseUp = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleKeyUp = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    const cleanup = result => {
      const listenerOptions = { capture: true, passive: false };
      document.removeEventListener('mousemove', handleMouseMove, listenerOptions);
      document.removeEventListener('click', handleClick, listenerOptions);
      document.removeEventListener('mousedown', handleMouseDown, listenerOptions);
      document.removeEventListener('mouseup', handleMouseUp, listenerOptions);
      document.removeEventListener('contextmenu', preventContext, listenerOptions);
      document.removeEventListener('keydown', handleKeydown, listenerOptions);
      document.removeEventListener('keyup', handleKeyUp, listenerOptions);
      window.removeEventListener('keydown', handleKeydown, listenerOptions);
      window.removeEventListener('keyup', handleKeyUp, listenerOptions);
      highlight.remove();
      label.remove();
      instructions.remove();
      window.__sylphAdblockPicker = undefined;
      resolve(result ?? null);
    };

    const updateHighlight = target => {
      if (!(target instanceof Element)) return;
      currentElement = target;
      const rect = target.getBoundingClientRect();
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
      const selector = getSelector(target) ?? target.nodeName.toLowerCase();
      label.textContent = selector;
      label.style.left = rect.left + rect.width / 2 + 'px';
      label.style.top = rect.top + 'px';
    };

    const handleMouseMove = event => {
      if (!isMouseMode) return;
      highlight.style.display = 'none';
      label.style.display = 'none';
      const target = document.elementFromPoint(event.clientX, event.clientY);
      highlight.style.display = 'block';
      label.style.display = 'block';
      if (!(target instanceof Element)) return;
      if (target === highlight || target === label || target === instructions) return;
      updateHighlight(target);
    };

    const handleClick = event => {
      console.log('[Sylph Picker] Click detected');
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const selector = getSelector(currentElement);
      if (selector) {
        const blockedOverlay = document.createElement('div');
        blockedOverlay.style.position = 'fixed';
        blockedOverlay.style.left = highlight.style.left;
        blockedOverlay.style.top = highlight.style.top;
        blockedOverlay.style.width = highlight.style.width;
        blockedOverlay.style.height = highlight.style.height;
        blockedOverlay.style.background = 'rgba(79, 178, 118, 0.8)';
        blockedOverlay.style.borderRadius = '6px';
        blockedOverlay.style.zIndex = '2147483645';
        blockedOverlay.style.pointerEvents = 'none';
        blockedOverlay.style.display = 'flex';
        blockedOverlay.style.alignItems = 'center';
        blockedOverlay.style.justifyContent = 'center';
        blockedOverlay.style.color = '#fff';
        blockedOverlay.style.fontSize = '14px';
        blockedOverlay.style.fontWeight = 'bold';
        blockedOverlay.style.fontFamily = 'system-ui, sans-serif';
        blockedOverlay.textContent = '✓ 차단됨';
        document.body.appendChild(blockedOverlay);
        try {
          document.querySelectorAll(selector).forEach(el => {
            if (el instanceof HTMLElement) {
              el.style.display = 'none';
            }
          });
        } catch (e) {
          console.warn('Failed to hide elements:', e);
        }
        setTimeout(() => {
          blockedOverlay.remove();
        }, 1200);
      }
      cleanup(selector ? { selector, hostname: window.location.hostname } : null);
    };

    const preventContext = event => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleKeydown = event => {
      console.log('[Sylph Picker] Key pressed:', event.key);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cleanup(null);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        isMouseMode = false;
        const parent = currentElement.parentElement;
        if (parent && parent !== document.documentElement) {
          updateHighlight(parent);
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        isMouseMode = false;
        const children = Array.from(currentElement.children).filter(
          child => child !== highlight && child !== label && child !== instructions
        );
        if (children.length > 0) {
          updateHighlight(children[0]);
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const selector = getSelector(currentElement);
        cleanup(selector ? { selector, hostname: window.location.hostname } : null);
        return;
      }
    };

    const listenerOptions = { capture: true, passive: false };
    document.addEventListener('mousemove', handleMouseMove, listenerOptions);
    document.addEventListener('click', handleClick, listenerOptions);
    document.addEventListener('mousedown', handleMouseDown, listenerOptions);
    document.addEventListener('mouseup', handleMouseUp, listenerOptions);
    document.addEventListener('contextmenu', preventContext, listenerOptions);
    document.addEventListener('keydown', handleKeydown, listenerOptions);
    document.addEventListener('keyup', handleKeyUp, listenerOptions);
    window.addEventListener('keydown', handleKeydown, listenerOptions);
    window.addEventListener('keyup', handleKeyUp, listenerOptions);

    document.body.appendChild(highlight);
    document.body.appendChild(label);
    document.body.appendChild(instructions);
    updateHighlight(document.body);

    window.__sylphAdblockPicker = {
      cleanup: () => cleanup(null),
    };
  });
})();
`;

const PASS_GUARD_LANGUAGES = ['ko-KR', 'ko', 'en-US', 'en'];

const parseHostInput = (value: string) =>
  sanitizeHostList(
    value
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean),
  );

const createDefaultPassGuardState = (): TabPassGuardState => ({
  active: false,
  source: 'auto',
  reason: '일반 탐색',
});

const clonePassGuardState = (
  state?: TabPassGuardState,
): TabPassGuardState | undefined => {
  if (!state) return undefined;
  return {
    active: state.active,
    source: state.source,
    reason: state.reason,
    userOverride: state.userOverride,
  };
};

const resolvePassGuardState = (tab: Tab, url: string, settings: PassGuardSettings): TabPassGuardState => {
  const current = tab.passGuard ?? createDefaultPassGuardState();
  const override = current.userOverride;
  if (override) {
    const manualActive = override === 'on';
    return {
      active: manualActive,
      source: 'manual',
      reason: manualActive ? '사용자 직접 활성화' : '사용자 직접 비활성화',
      userOverride: override,
    };
  }
  const detection = detectPassGuardTrigger(url, {
    autoDetectionEnabled: settings.autoDetectionEnabled,
    includeHosts: settings.includeHosts,
    excludeHosts: settings.excludeHosts,
  });
  if (detection.shouldEnable) {
    return {
      active: true,
      source: 'auto',
      reason: detection.reason ?? '로그인 페이지 자동 감지',
    };
  }
  return {
    active: false,
    source: 'auto',
    reason:
      detection.reason ??
      (settings.autoDetectionEnabled ? '일반 탐색' : '자동 감지 꺼짐'),
  };
};

type StealthInjectionConfig = {
  userAgent: string;
  platform: string;
  languages: string[];
  vendor: string;
  productSub: string;
  appVersion: string;
  removeUserAgentData: boolean;
};

type AppliedPassGuardSnapshot = {
  active: boolean;
  userAgent: string;
  platform: string;
  vendor: string;
  productSub: string;
  appVersion: string;
  removeUserAgentData: boolean;
  source: 'auto' | 'manual';
  reason?: string;
  userOverride?: PassGuardUserOverride;
};

const createStealthInjectionScript = ({
  userAgent,
  platform,
  languages,
  vendor,
  productSub,
  appVersion,
  removeUserAgentData,
}: StealthInjectionConfig) => `
(() => {
  const CONFIG = {
    userAgent: ${JSON.stringify(userAgent)},
    platform: ${JSON.stringify(platform)},
    languages: ${JSON.stringify(languages)},
    vendor: ${JSON.stringify(vendor)},
    productSub: ${JSON.stringify(productSub)},
    appVersion: ${JSON.stringify(appVersion)},
    removeUserAgentData: ${JSON.stringify(removeUserAgentData)},
  };
  const previous = window.__sylphStealthConfig || null;
  const languagesChanged = !previous?.languages || previous.languages.length !== CONFIG.languages.length ||
    previous.languages.some((value, index) => value !== CONFIG.languages[index]);
  if (
    previous &&
    previous.userAgent === CONFIG.userAgent &&
    previous.platform === CONFIG.platform &&
    previous.vendor === CONFIG.vendor &&
    previous.productSub === CONFIG.productSub &&
    previous.appVersion === CONFIG.appVersion &&
    previous.removeUserAgentData === CONFIG.removeUserAgentData &&
    !languagesChanged
  ) {
    return;
  }
  window.__sylphStealthConfig = CONFIG;
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // Enhanced chrome object for Web Store compatibility
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      id: undefined,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onConnect: { addListener: () => {}, removeListener: () => {} },
    };
  }

  Object.defineProperty(navigator, 'languages', {
    get: () => CONFIG.languages.slice(),
    configurable: true,
  });
  Object.defineProperty(navigator, 'platform', {
    get: () => CONFIG.platform,
    configurable: true,
  });
  Object.defineProperty(navigator, 'vendor', {
    get: () => CONFIG.vendor,
    configurable: true,
  });
  Object.defineProperty(navigator, 'productSub', {
    get: () => CONFIG.productSub,
    configurable: true,
  });
  Object.defineProperty(navigator, 'appVersion', {
    get: () => CONFIG.appVersion,
    configurable: true,
  });

  // Properly fake userAgentData for Chrome Web Store
  const isChromeUA = CONFIG.userAgent.includes('Chrome/') && !CONFIG.userAgent.includes('Firefox/');
  if (CONFIG.removeUserAgentData || !isChromeUA) {
    try {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => undefined,
        configurable: true,
      });
    } catch {
      try {
        navigator.userAgentData = undefined;
      } catch {}
    }
  } else if (isChromeUA) {
    // Fake Chrome's userAgentData
    const chromeVersion = CONFIG.userAgent.match(/Chrome\\/([0-9]+)/)?.[1] || '131';
    const fakeUserAgentData = {
      brands: [
        { brand: 'Google Chrome', version: chromeVersion },
        { brand: 'Chromium', version: chromeVersion },
        { brand: 'Not.A/Brand', version: '24' },
      ],
      mobile: false,
      platform: CONFIG.platform,
      getHighEntropyValues: (hints) => Promise.resolve({
        brands: [
          { brand: 'Google Chrome', version: chromeVersion },
          { brand: 'Chromium', version: chromeVersion },
          { brand: 'Not.A/Brand', version: '24' },
        ],
        mobile: false,
        platform: CONFIG.platform,
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        uaFullVersion: chromeVersion + '.0.0.0',
        fullVersionList: [
          { brand: 'Google Chrome', version: chromeVersion + '.0.0.0' },
          { brand: 'Chromium', version: chromeVersion + '.0.0.0' },
          { brand: 'Not.A/Brand', version: '24.0.0.0' },
        ],
      }),
      toJSON: function() {
        return {
          brands: this.brands,
          mobile: this.mobile,
          platform: this.platform,
        };
      },
    };
    try {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => fakeUserAgentData,
        configurable: true,
      });
    } catch {}
  }
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true,
  });
  const fakePlugins = Array.from({ length: 5 }, (_, index) => ({ length: index + 1 }));
  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true,
  });
  const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
  if (originalQuery) {
    window.navigator.permissions.query = parameters =>
      parameters?.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters).catch(() => ({ state: 'prompt' }));
  }
  Object.defineProperty(navigator, 'userAgent', {
    get: () => CONFIG.userAgent,
    configurable: true,
  });
})();
`;

const createTabState = (overrides: Partial<Tab> = {}): Tab => ({
  id: uuidv4(),
  title: overrides.title ?? 'New Tab',
  url: overrides.url ?? '',
  favicon: overrides.favicon ?? '',
  spaceId: overrides.spaceId ?? DEFAULT_SPACE_ID,
  isActive: overrides.isActive ?? false,
  isLoading: overrides.isLoading ?? false,
  isCrashed: overrides.isCrashed ?? false,
  canGoBack: overrides.canGoBack ?? false,
  canGoForward: overrides.canGoForward ?? false,
  history: overrides.history ? [...overrides.history] : [],
  createdAt: overrides.createdAt ?? Date.now(),
  updatedAt: overrides.updatedAt ?? Date.now(),
  incognito: overrides.incognito,
  isPinned: overrides.isPinned,
  isMuted: overrides.isMuted,
  unread: overrides.unread,
  aiContext: cloneAiContext(overrides.aiContext),
  automation: cloneAutomationState(overrides.automation),
  passGuard: clonePassGuardState(overrides.passGuard) ?? createDefaultPassGuardState(),
});

type CreateTabOptions = {
  url?: string;
  title?: string;
  makeActive?: boolean;
  initialState?: Partial<Tab>;
  insertIndex?: number;
  spaceId?: string;
  profileId?: string;
  incognito?: boolean;
};

type WebviewNewWindowEvent = Event & {
  preventDefault: () => void;
  url?: string;
  frameName?: string;
  disposition: 'default' | 'foreground-tab' | 'background-tab' | 'new-window' | 'other';
};

type TabSnapshot = {
  title: string;
  url: string;
  favicon?: string;
  history: string[];
  spaceId: string;
  isPinned?: boolean;
  incognito?: boolean;
  isMuted?: boolean;
  aiContext?: TabAIContext;
  automation?: Tab['automation'];
  passGuard?: Tab['passGuard'];
};

const resolveFaviconUrl = (favicons: string[], pageUrl: string): string => {
  // First check if we have a data: URL (always works with CSP)
  for (const icon of favicons) {
    if (!icon) continue;
    const lower = icon.toLowerCase();
    if (lower.startsWith('data:')) return icon;
  }

  // Use Google's favicon service as it's more reliable and CSP-friendly
  try {
    const url = new URL(pageUrl);
    if (url.hostname) {
      return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(url.hostname)}`;
    }
  } catch {
    // ignore parse errors
  }
  return '';
};

const extractHostname = (rawUrl: string | undefined | null): string | null => {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return url.hostname || null;
  } catch {
    return null;
  }
};

const isChromeWebStore = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'chromewebstore.google.com' ||
           parsed.hostname === 'chrome.google.com';
  } catch {
    return false;
  }
};

const cloneAiContext = (context?: TabAIContext): TabAIContext | undefined => {
  if (!context) return undefined;
  return {
    selectedText: context.selectedText,
    lastUsedAt: context.lastUsedAt,
    messages: context.messages.map(message => ({ ...message })),
  };
};

const cloneAutomationRun = (run: AetherAutomationRun): AetherAutomationRun => ({
  ...run,
  steps: run.steps.map(step => ({
    ...step,
    detail: step.detail
      ? {
          command: step.detail.command ? { ...step.detail.command } : undefined,
        }
      : undefined,
  })),
});

const cloneAutomationState = (
  automation?: Tab['automation'],
): Tab['automation'] | undefined => {
  if (!automation) return undefined;
  return {
    activeRunId: automation.activeRunId,
    runs: automation.runs.map(cloneAutomationRun),
  };
};

const isTerminalStatus = (status: AetherAutomationRun['status']) =>
  status === 'completed' || status === 'cancelled' || status === 'error';

const formatAutomationStatus = (status: AetherAutomationRun['status']) => {
  switch (status) {
    case 'starting':
      return 'Starting…';
    case 'awaiting-approval':
      return 'Waiting for approval';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return 'Error';
    default:
      return status;
  }
};

const formatStepStatus = (status: AetherAutomationStep['status']) => {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'awaiting-approval':
      return 'Awaiting approval';
    case 'approved':
      return 'Approved';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
};

const renderMarkdown = (content: string) => {
  const parsed = marked.parse(content, { breaks: true });
  const html = typeof parsed === 'string' ? parsed : parsed.toString();
  return DOMPurify.sanitize(html);
};

const runHasActiveWork = (run: AetherAutomationRun) =>
  run.steps.some(step =>
    step.status === 'running' || step.status === 'pending' || step.status === 'awaiting-approval',
  );

const runIsThinking = (run: AetherAutomationRun) => !isTerminalStatus(run.status) && !runHasActiveWork(run);

type ComposerMode = 'auto' | 'ask' | 'agent-thinking' | 'agent-fast';

const composerModeToRunMode = (mode: ComposerMode): 'auto' | 'agent_thinking' | 'agent_fast' => {
  if (mode === 'agent-thinking') return 'agent_thinking';
  if (mode === 'agent-fast') return 'agent_fast';
  return 'auto';
};

const isAgentComposerMode = (mode: ComposerMode) => mode === 'agent-thinking' || mode === 'agent-fast';
const isAgentRunMode = (mode: string | undefined) => mode === 'agent_thinking' || mode === 'agent_fast';

const shouldAutoRunAutomation = (prompt: string) => {
  const lowered = prompt.toLowerCase();
  const actionKeywords = [
    'click',
    'open',
    'navigate',
    'fill',
    'submit',
    'buy',
    'search',
    'log in',
    'login',
    'scroll',
    'select',
    'download',
    'upload',
    'register',
    'sign up',
    'delete',
    'update',
    'install',
    'checkout',
    'subscribe',
    '예약',
    '클릭',
    '열어',
    '검색',
    '입력',
    '제출',
    '구매',
    '로그인',
    '스크롤',
    '선택',
    '다운로드',
    '업로드',
    '가입',
    '삭제',
    '변경',
    '설치',
  ];
  return actionKeywords.some(keyword => lowered.includes(keyword));
};

const clampAiPanelWidth = (value: number) =>
  Math.min(MAX_AI_PANEL_WIDTH, Math.max(MIN_AI_PANEL_WIDTH, value));

const App = () => {
  const [homePageUrl, setHomePageUrl] = useState<string>(DEFAULT_HOME_URL);
  const [spaces, setSpaces] = useState<Space[]>(() => {
    try {
      const stored = window.localStorage?.getItem(SPACES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load spaces from storage', error);
    }
    return [
      {
        id: DEFAULT_SPACE_ID,
        name: DEFAULT_SPACE_NAME,
        color: 'var(--color-green-400)',
      },
    ];
  });
  const [activeSpaceId, setActiveSpaceId] = useState<string>(() => {
    try {
      const stored = window.localStorage?.getItem(ACTIVE_SPACE_STORAGE_KEY);
      if (stored) {
        return stored;
      }
    } catch (error) {
      console.warn('Failed to load active space from storage', error);
    }
    return DEFAULT_SPACE_ID;
  });
  const [tabsBySpace, setTabsBySpace] = useState<Record<string, Tab[]>>(() => {
    try {
      const stored = window.localStorage?.getItem(TABS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load tabs from storage', error);
    }
    return {
      [DEFAULT_SPACE_ID]: [],
    };
  });
  const webviewsRef = useRef<Map<string, WebviewTag>>(new Map());
  const [addressValue, setAddressValue] = useState('');
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<HistoryEntry[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [composerValue, setComposerValue] = useState('');
  const [isAiSending, setIsAiSending] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>('auto');
  const [automationBootstrapMessageId, setAutomationBootstrapMessageId] = useState<string | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState<number>(DEFAULT_AI_PANEL_WIDTH);
  const [isAiCollapsed, setIsAiCollapsed] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [spaceContextMenuId, setSpaceContextMenuId] = useState<string | null>(null);
  const [splitStatesBySpace, setSplitStatesBySpace] = useState<Record<string, SplitState>>({});
  const [spaceMenuTabId, setSpaceMenuTabId] = useState<string | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  const webviewListenersRef = useRef<Map<string, () => void>>(new Map());
  const activeWebviewRef = useRef<WebviewTag | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const latestAddressFocusRef = useRef(false);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const closedTabsRef = useRef<TabSnapshot[]>([]);
  const tabsByIdRef = useRef<Map<string, Tab>>(new Map());
  const passGuardAppliedRef = useRef<Map<string, AppliedPassGuardSnapshot>>(new Map());
  const passGuardPanelRef = useRef<HTMLDivElement | null>(null);
  const [passGuardSettings, setPassGuardSettings] = useState<PassGuardSettings>(() => ({
    ...DEFAULT_PASS_GUARD_SETTINGS,
  }));
  const [passGuardIncludeDraft, setPassGuardIncludeDraft] = useState('');
  const [passGuardExcludeDraft, setPassGuardExcludeDraft] = useState('');
  const [isPassGuardPanelOpen, setIsPassGuardPanelOpen] = useState(false);
  const [isAdblockPanelOpen, setIsAdblockPanelOpen] = useState(false);
  const [adblockState, setAdblockState] = useState<AdblockerState | null>(null);
  const [isAdblockStateLoading, setIsAdblockStateLoading] = useState(false);
  const [adblockCustomRuleInput, setAdblockCustomRuleInput] = useState('');
  const [adblockError, setAdblockError] = useState<string | null>(null);
  const [isAdblockPickerActive, setIsAdblockPickerActive] = useState(false);
  const [adblockSuccessMessage, setAdblockSuccessMessage] = useState<string | null>(null);
  const [historyDatabase, setHistoryDatabase] = useState<HistoryDatabase>(() => {
    try {
      const stored = window.localStorage?.getItem(HISTORY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          entries: new Map(Object.entries(parsed.entries || {})),
          lastCleanup: parsed.lastCleanup || Date.now(),
        };
      }
    } catch (error) {
      console.warn('Failed to load history database', error);
    }
    return { entries: new Map(), lastCleanup: Date.now() };
  });
  const [archivedTabs, setArchivedTabs] = useState<ArchivedTab[]>(() => {
    try {
      const stored = window.localStorage?.getItem(ARCHIVE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load archived tabs', error);
    }
    return [];
  });
  const [archiveSettings, setArchiveSettings] = useState<ArchiveSettings>(() => {
    try {
      const stored = window.localStorage?.getItem(ARCHIVE_SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_ARCHIVE_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load archive settings', error);
    }
    return DEFAULT_ARCHIVE_SETTINGS;
  });
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    try {
      const stored = window.localStorage?.getItem(PROFILES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load profiles', error);
    }
    return [createDefaultProfile()];
  });

  // Get profileId from URL query parameter if this window was opened for a specific profile
  const windowProfileId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('profileId') || DEFAULT_PROFILE_ID;
  }, []);

  const [activeProfileId, setActiveProfileId] = useState<string>(windowProfileId);

  // Filter tabs by current window's profile
  const tabs = useMemo(() => {
    const spaceTabs = tabsBySpace[activeSpaceId] ?? [];
    return spaceTabs.filter(tab => (tab.profileId || DEFAULT_PROFILE_ID) === activeProfileId);
  }, [tabsBySpace, activeSpaceId, activeProfileId]);

  const allTabs = useMemo(
    () => Object.values(tabsBySpace).flatMap(spaceTabs =>
      spaceTabs.filter(tab => (tab.profileId || DEFAULT_PROFILE_ID) === activeProfileId)
    ),
    [tabsBySpace, activeProfileId],
  );

  // Get active profile (from active tab or default)
  const activeProfile = useMemo(() => {
    const activeTab = allTabs.find(tab => tab.isActive);
    if (activeTab?.profileId) {
      return profiles.find(p => p.id === activeTab.profileId) || profiles[0];
    }
    return profiles.find(p => p.id === activeProfileId) || profiles[0];
  }, [allTabs, profiles, activeProfileId]);

  useEffect(() => {
    const map = new Map<string, Tab>();
    allTabs.forEach(tab => map.set(tab.id, tab));
    tabsByIdRef.current = map;
  }, [allTabs]);

  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem(PASS_GUARD_SETTINGS_STORAGE_KEY) ?? null;
      if (!raw) {
        setPassGuardSettings({ ...DEFAULT_PASS_GUARD_SETTINGS });
        return;
      }
      const parsed = JSON.parse(raw) as Partial<PassGuardSettings>;
      setPassGuardSettings(normalizePassGuardSettings(parsed));
    } catch (error) {
      console.warn('Failed to load PassGuard settings', error);
      setPassGuardSettings({ ...DEFAULT_PASS_GUARD_SETTINGS });
    }
  }, []);

  useEffect(() => {
    setPassGuardIncludeDraft(passGuardSettings.includeHosts.join('\n'));
    setPassGuardExcludeDraft(passGuardSettings.excludeHosts.join('\n'));
  }, [passGuardSettings.includeHosts, passGuardSettings.excludeHosts]);

  const updatePassGuardSettings = useCallback(
    (
      update:
        | Partial<PassGuardSettings>
        | ((current: PassGuardSettings) => Partial<PassGuardSettings>),
    ) => {
      setPassGuardSettings(prev => {
        const partial = typeof update === 'function' ? update(prev) : update;
        const mergedInput = { ...prev, ...partial };
        const normalized = normalizePassGuardSettings(mergedInput);
        try {
          window.localStorage?.setItem(
            PASS_GUARD_SETTINGS_STORAGE_KEY,
            JSON.stringify(normalized),
          );
        } catch (error) {
          console.warn('Failed to persist PassGuard settings', error);
        }
        return normalized;
      });
    },
    [],
  );

  // History management functions
  const saveHistoryToStorage = useCallback((db: HistoryDatabase) => {
    try {
      const serialized = {
        entries: Object.fromEntries(db.entries),
        lastCleanup: db.lastCleanup,
      };
      window.localStorage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(serialized));
    } catch (error) {
      console.warn('Failed to save history database', error);
    }
  }, []);

  const addToHistory = useCallback((url: string, title: string, favicon?: string, wasTyped = false) => {
    // Skip about: and data: URLs
    if (!url || url.startsWith('about:') || url.startsWith('data:')) {
      return;
    }

    setHistoryDatabase(prev => {
      const now = Date.now();
      const entries = new Map(prev.entries);
      const existing = entries.get(url);

      if (existing) {
        // Update existing entry
        entries.set(url, {
          ...existing,
          title,
          favicon: favicon || existing.favicon,
          visitCount: existing.visitCount + 1,
          lastVisitTime: now,
          typedCount: wasTyped ? existing.typedCount + 1 : existing.typedCount,
        });
      } else {
        // Create new entry
        entries.set(url, {
          id: uuidv4(),
          url,
          title,
          favicon,
          visitCount: 1,
          lastVisitTime: now,
          firstVisitTime: now,
          typedCount: wasTyped ? 1 : 0,
        });
      }

      // Cleanup old entries if needed
      let shouldCleanup = false;
      if (entries.size > MAX_HISTORY_ENTRIES) {
        shouldCleanup = true;
      } else if (now - prev.lastCleanup > HISTORY_CLEANUP_INTERVAL) {
        shouldCleanup = true;
      }

      if (shouldCleanup) {
        // Remove oldest entries if we exceed the limit
        if (entries.size > MAX_HISTORY_ENTRIES) {
          const sorted = Array.from(entries.values()).sort((a, b) => a.lastVisitTime - b.lastVisitTime);
          const toRemove = sorted.slice(0, entries.size - MAX_HISTORY_ENTRIES);
          toRemove.forEach(entry => entries.delete(entry.url));
        }
      }

      const newDb = {
        entries,
        lastCleanup: shouldCleanup ? now : prev.lastCleanup,
      };

      saveHistoryToStorage(newDb);
      return newDb;
    });
  }, [saveHistoryToStorage]);

  const searchHistory = useCallback((query: string, limit = 10): HistoryEntry[] => {
    const lowerQuery = query.toLowerCase();
    const results = Array.from(historyDatabase.entries.values())
      .filter(entry =>
        entry.url.toLowerCase().includes(lowerQuery) ||
        entry.title.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => {
        // Prioritize typed URLs
        if (a.typedCount !== b.typedCount) {
          return b.typedCount - a.typedCount;
        }
        // Then by visit count
        if (a.visitCount !== b.visitCount) {
          return b.visitCount - a.visitCount;
        }
        // Then by last visit time
        return b.lastVisitTime - a.lastVisitTime;
      })
      .slice(0, limit);
    return results;
  }, [historyDatabase]);

  // Update address suggestions when address value changes
  useEffect(() => {
    if (!isAddressFocused || !addressValue.trim()) {
      setAddressSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    const suggestions = searchHistory(addressValue, 5);
    setAddressSuggestions(suggestions);
    setSelectedSuggestionIndex(-1);
  }, [addressValue, isAddressFocused, searchHistory]);

  useEffect(() => {
    if (!isPassGuardPanelOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPassGuardPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPassGuardPanelOpen]);

  // Save tabs state to localStorage whenever it changes
  useEffect(() => {
    try {
      window.localStorage?.setItem(TABS_STORAGE_KEY, JSON.stringify(tabsBySpace));
    } catch (error) {
      console.warn('Failed to save tabs to storage', error);
    }
  }, [tabsBySpace]);

  // Save spaces to localStorage whenever they change
  useEffect(() => {
    try {
      window.localStorage?.setItem(SPACES_STORAGE_KEY, JSON.stringify(spaces));
    } catch (error) {
      console.warn('Failed to save spaces to storage', error);
    }
  }, [spaces]);

  // Save active space to localStorage whenever it changes
  useEffect(() => {
    try {
      window.localStorage?.setItem(ACTIVE_SPACE_STORAGE_KEY, activeSpaceId);
    } catch (error) {
      console.warn('Failed to save active space to storage', error);
    }
  }, [activeSpaceId]);

  // Save archived tabs to localStorage whenever they change
  useEffect(() => {
    try {
      window.localStorage?.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archivedTabs));
    } catch (error) {
      console.warn('Failed to save archived tabs to storage', error);
    }
  }, [archivedTabs]);

  // Save archive settings to localStorage whenever they change
  useEffect(() => {
    try {
      window.localStorage?.setItem(ARCHIVE_SETTINGS_STORAGE_KEY, JSON.stringify(archiveSettings));
    } catch (error) {
      console.warn('Failed to save archive settings to storage', error);
    }
  }, [archiveSettings]);

  // Save profiles to localStorage whenever they change
  useEffect(() => {
    try {
      window.localStorage?.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    } catch (error) {
      console.warn('Failed to save profiles to storage', error);
    }
  }, [profiles]);

  const refreshAdblockState = useCallback(async () => {
    if (!window.sylph?.adblocker?.getState) return;
    setIsAdblockStateLoading(true);
    setAdblockError(null);
    try {
      const state = await window.sylph.adblocker.getState();
      setAdblockState(state);
    } catch (error) {
      setAdblockError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAdblockStateLoading(false);
    }
  }, []);

  const cancelAdblockElementPicker = useCallback(() => {
    const webview = activeWebviewRef.current;
    if (webview) {
      void webview
        .executeJavaScript(
          'if (window.__sylphAdblockPicker && typeof window.__sylphAdblockPicker.cleanup === "function") { window.__sylphAdblockPicker.cleanup(); }',
          true,
        )
        .catch(() => undefined);
    }
    setIsAdblockPickerActive(false);
  }, []);

  const handleAdblockPanelClose = useCallback(() => {
    cancelAdblockElementPicker();
    setIsAdblockPanelOpen(false);
  }, [cancelAdblockElementPicker]);

  useEffect(() => {
    if (isAdblockPanelOpen) {
      void refreshAdblockState();
    }
  }, [isAdblockPanelOpen, refreshAdblockState]);

  useEffect(() => {
    if (!isAdblockPanelOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleAdblockPanelClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleAdblockPanelClose, isAdblockPanelOpen]);

  useEffect(() => {
    if (!isAdblockPanelOpen && isAdblockPickerActive) {
      cancelAdblockElementPicker();
    }
  }, [cancelAdblockElementPicker, isAdblockPanelOpen, isAdblockPickerActive]);

  useEffect(() => {
    const stateDisposer = window.sylph?.adblocker?.onStateChange?.(nextState => {
      setAdblockState(nextState);
      setAdblockError(null);
    });
    const blockedDisposer = window.sylph?.adblocker?.onBlocked?.(({ entry, totalBlocked }) => {
      setAdblockState(previous => {
        if (!previous) return previous;
        const nextEntries = [entry, ...previous.recentBlocked.filter(item => item.id !== entry.id)].slice(0, 50);
        return {
          ...previous,
          totalBlocked,
          recentBlocked: nextEntries,
        };
      });
    });
    return () => {
      stateDisposer?.();
      blockedDisposer?.();
    };
  }, []);

  const applyPassGuardToTab = useCallback(
    async (tab: Tab) => {
      const state = tab.passGuard ?? createDefaultPassGuardState();
      const useChromeUA = state.active && isChromeWebStore(tab.url);
      const activeProfile = state.active
        ? {
            userAgent: passGuardSettings.customUserAgent || (useChromeUA ? CHROME_USER_AGENT : PASS_GUARD_USER_AGENT),
            platform: passGuardSettings.customPlatform || 'Win32',
            vendor: passGuardSettings.customVendor || (useChromeUA ? 'Google Inc.' : ''),
            productSub: passGuardSettings.customProductSub || (useChromeUA ? '20030107' : '20100101'),
            appVersion: passGuardSettings.customAppVersion || (useChromeUA ? '5.0 (Windows NT 10.0; Win64; x64)' : '5.0 (Windows)'),
            removeUserAgentData: passGuardSettings.removeUserAgentData,
          }
        : {
            userAgent: DEFAULT_USER_AGENT,
            platform: 'MacIntel',
            vendor: 'Google Inc.',
            productSub: '20030107',
            appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            removeUserAgentData: false,
          };
      const languages = PASS_GUARD_LANGUAGES;
      const previous = passGuardAppliedRef.current.get(tab.id);
      const userAgentChanged = previous?.userAgent !== activeProfile.userAgent;
      const platformChanged = previous?.platform !== activeProfile.platform;
      const vendorChanged = previous?.vendor !== activeProfile.vendor;
      const productSubChanged = previous?.productSub !== activeProfile.productSub;
      const appVersionChanged = previous?.appVersion !== activeProfile.appVersion;
      const uaDataChanged =
        previous?.removeUserAgentData !== activeProfile.removeUserAgentData;
      const activeChanged = previous?.active !== state.active;
      const sourceChanged = previous?.source !== state.source;
      const reasonChanged = previous?.reason !== state.reason;
      const overrideChanged = previous?.userOverride !== state.userOverride;
      const shouldNotifyMain =
        !previous ||
        userAgentChanged ||
        activeChanged ||
        sourceChanged ||
        reasonChanged ||
        overrideChanged;
      const shouldReload =
        state.active &&
        (userAgentChanged ||
          activeChanged ||
          sourceChanged ||
          overrideChanged ||
          platformChanged ||
          vendorChanged ||
          productSubChanged ||
          appVersionChanged ||
          uaDataChanged);

      const webview = webviewsRef.current.get(tab.id);
      const payload = {
        tabId: tab.id,
        webContentsId: null as number | null,
        active: state.active,
        userAgent: activeProfile.userAgent,
        source: state.source,
        reason: state.reason,
        userOverride: state.userOverride,
      };

      if (webview) {
        const webContentsId =
          typeof webview.getWebContentsId === 'function'
            ? (() => {
                try {
                  return webview.getWebContentsId();
                } catch (error) {
                  console.warn('PassGuard: webview not ready for webContentsId yet', error);
                  return undefined;
                }
              })()
            : undefined;
        payload.webContentsId = typeof webContentsId === 'number' ? webContentsId : null;

        if (payload.webContentsId !== null) {
          const appliedSnapshot: AppliedPassGuardSnapshot = {
            active: state.active,
            userAgent: activeProfile.userAgent,
            platform: activeProfile.platform,
            vendor: activeProfile.vendor,
            productSub: activeProfile.productSub,
            appVersion: activeProfile.appVersion,
            removeUserAgentData: activeProfile.removeUserAgentData,
            source: state.source,
            reason: state.reason,
            userOverride: state.userOverride,
          };
          passGuardAppliedRef.current.set(tab.id, appliedSnapshot);

          if (userAgentChanged && typeof webview.setUserAgent === 'function') {
            try {
              webview.setUserAgent(activeProfile.userAgent);
            } catch (error) {
              console.warn('Failed to apply user agent to webview', error);
            }
          }

          try {
            const script = createStealthInjectionScript({
              userAgent: activeProfile.userAgent,
              platform: activeProfile.platform,
              languages,
              vendor: activeProfile.vendor,
              productSub: activeProfile.productSub,
              appVersion: activeProfile.appVersion,
              removeUserAgentData: activeProfile.removeUserAgentData,
            });
            await webview.executeJavaScript(script, true);
          } catch (error) {
            console.warn('Failed to inject stealth script', error);
          }

          if (shouldReload && typeof webview.reload === 'function') {
            try {
              webview.reload();
            } catch (error) {
              console.warn('Failed to reload webview after PassGuard update', error);
            }
          }
        }
      }

      if (payload.webContentsId === null) {
        passGuardAppliedRef.current.delete(tab.id);
      }

      if (shouldNotifyMain && payload.webContentsId !== null) {
        window.sylph?.passGuard?.updateState?.(payload);
      }
    },
    [passGuardSettings, webviewsRef],
  );

  useEffect(() => {
    const knownIds = new Set(allTabs.map(tab => tab.id));
    for (const key of Array.from(passGuardAppliedRef.current.keys())) {
      if (!knownIds.has(key)) {
        passGuardAppliedRef.current.delete(key);
      }
    }
    allTabs.forEach(tab => {
      const state = tab.passGuard ?? createDefaultPassGuardState();
      const profile = state.active
        ? {
            userAgent: passGuardSettings.customUserAgent || PASS_GUARD_USER_AGENT,
            platform: passGuardSettings.customPlatform || 'Win32',
            vendor: passGuardSettings.customVendor || '',
            productSub: passGuardSettings.customProductSub || '20100101',
            appVersion: passGuardSettings.customAppVersion || '5.0 (Windows)',
            removeUserAgentData: passGuardSettings.removeUserAgentData,
          }
        : {
            userAgent: DEFAULT_USER_AGENT,
            platform: 'MacIntel',
            vendor: 'Google Inc.',
            productSub: '20030107',
            appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            removeUserAgentData: false,
          };
      const snapshot = passGuardAppliedRef.current.get(tab.id);
      if (
        !snapshot ||
        snapshot.active !== state.active ||
        snapshot.userAgent !== profile.userAgent ||
        snapshot.platform !== profile.platform ||
        snapshot.vendor !== profile.vendor ||
        snapshot.productSub !== profile.productSub ||
        snapshot.appVersion !== profile.appVersion ||
        snapshot.removeUserAgentData !== profile.removeUserAgentData ||
        snapshot.source !== state.source ||
        snapshot.reason !== state.reason ||
        snapshot.userOverride !== state.userOverride
      ) {
        void applyPassGuardToTab(tab);
      }
    });
  }, [allTabs, applyPassGuardToTab, passGuardSettings]);
  const runAssistantMessageMapRef = useRef<Map<string, string>>(new Map());
  const pendingChatBuffersRef = useRef<Map<string, string>>(new Map());
  const pendingChatFinalRef = useRef<Map<string, { content: string; status: 'completed' | 'error' }>>(new Map());
  const assistantMessageMetaRef = useRef<Map<string, { prompt: string; selection?: string }>>(new Map());
  const automationRunModeRef = useRef<Map<string, 'auto' | 'agent_thinking' | 'agent_fast'>>(new Map());
  const resizerActiveRef = useRef(false);
  const resizerStartXRef = useRef(0);
  const resizerStartWidthRef = useRef(DEFAULT_AI_PANEL_WIDTH);
  const splitResizerActiveRef = useRef(false);
  const splitResizerStartXRef = useRef(0);
  const splitResizerStartRatioRef = useRef(DEFAULT_SPLIT_RATIO);

  const updateTabsForSpace = useCallback(
    (spaceId: string, updater: (list: Tab[]) => Tab[]) => {
      setTabsBySpace(prev => {
        const current = prev[spaceId] ?? [];
        const next = updater(current);
        if (next === current) {
          return prev;
        }
        return {
          ...prev,
          [spaceId]: next,
        };
      });
    },
    [],
  );

  const updateSplitState = useCallback(
    (spaceId: string, updater: (state: SplitState) => SplitState) => {
      setSplitStatesBySpace(prev => {
        const current = prev[spaceId] ?? createDefaultSplitState();
        const next = updater(current);
        if (
          next.isSplit === current.isSplit &&
          next.primaryTabId === current.primaryTabId &&
          next.secondaryTabId === current.secondaryTabId &&
          next.focus === current.focus &&
          next.ratio === current.ratio
        ) {
          return prev;
        }
        return {
          ...prev,
          [spaceId]: next,
        };
      });
    },
    [],
  );

  const getSplitState = useCallback(
    (spaceId: string): SplitState =>
      splitStatesBySpace[spaceId] ?? createDefaultSplitState(),
    [splitStatesBySpace],
  );

  const reconcileSplitState = useCallback(
    (spaceId: string, nextTabs: Tab[]) => {
      updateSplitState(spaceId, state => {
        if (!state.isSplit) return state;
        const idSet = new Set(nextTabs.map(tab => tab.id));
        let primaryTabId = state.primaryTabId && idSet.has(state.primaryTabId) ? state.primaryTabId : null;
        let secondaryTabId =
          state.secondaryTabId && idSet.has(state.secondaryTabId) ? state.secondaryTabId : null;
        let focus = state.focus;
        let changed = false;

        if (!primaryTabId && nextTabs.length > 0) {
          primaryTabId = nextTabs[0].id;
          focus = 'primary';
          changed = true;
        }

        let secondaryAdjusted = false;
        if (!secondaryTabId || secondaryTabId === primaryTabId) {
          const candidate = nextTabs.find(tab => tab.id !== primaryTabId) ?? null;
          secondaryTabId = candidate?.id ?? null;
          secondaryAdjusted = true;
        }

        if (!primaryTabId) {
          return {
            ...state,
            isSplit: false,
            primaryTabId: null,
            secondaryTabId: null,
            focus: 'primary',
          };
        }

        if (!secondaryTabId) {
          return {
            ...state,
            isSplit: true,
            primaryTabId,
            secondaryTabId: null,
            focus: 'primary',
          };
        }

        if (!idSet.has(state.secondaryTabId ?? '')) {
          focus = 'primary';
          changed = true;
        }

        if (!changed && !secondaryAdjusted) {
          return state;
        }

        return {
          ...state,
          primaryTabId,
          secondaryTabId,
          focus,
        };
      });
    },
    [updateSplitState],
  );

  const ensureSpaceHasActiveTab = useCallback(
    (spaceId: string) => {
      const spaceTabs = tabsBySpace[spaceId] ?? [];
      if (spaceTabs.length === 0) return;
      if (spaceTabs.some(tab => tab.isActive)) return;
      let nextList: Tab[] | null = null;
      updateTabsForSpace(spaceId, list => {
        nextList = list.map((tab, index) => ({
          ...tab,
          isActive: index === list.length - 1,
        }));
        return nextList;
      });
      if (nextList) {
        reconcileSplitState(spaceId, nextList);
      }
    },
    [reconcileSplitState, tabsBySpace, updateTabsForSpace],
  );

  const activateSpace = useCallback(
    (spaceId: string) => {
      setActiveSpaceId(spaceId);
      ensureSpaceHasActiveTab(spaceId);
    },
    [ensureSpaceHasActiveTab],
  );

  const reorderTabs = useCallback((list: Tab[]) => {
    const pinned = list.filter(tab => tab.isPinned);
    const others = list.filter(tab => !tab.isPinned);
    return [...pinned, ...others];
  }, []);

  const createSpace = useCallback(() => {
    const spaceId = uuidv4();
    setSpaces(prev => {
      const nextSpace: Space = {
        id: spaceId,
        name: `Space ${prev.length + 1}`,
        color: SPACE_COLOR_PALETTE[prev.length % SPACE_COLOR_PALETTE.length],
      };
      return [...prev, nextSpace];
    });
    const resolvedHomeUrl = homePageUrl || DEFAULT_HOME_URL;
    const initialTab = createTabState({
      isActive: true,
      url: resolvedHomeUrl,
      title: DEFAULT_HOME_TITLE,
      spaceId,
      history: resolvedHomeUrl ? [resolvedHomeUrl] : [],
    });
    setTabsBySpace(prev => ({
      ...prev,
      [spaceId]: [initialTab],
    }));
    updateSplitState(spaceId, () => createDefaultSplitState());
    activateSpace(spaceId);
  }, [activateSpace, homePageUrl, updateSplitState]);

  const renameSpace = useCallback(
    (spaceId: string) => {
      const space = spaces.find(item => item.id === spaceId);
      const currentName = space?.name ?? 'Space';
      const nextName = window.prompt('스페이스 이름을 입력하세요', currentName)?.trim();
      if (!nextName || nextName === currentName) return;
      setSpaces(prev =>
        prev.map(item => (item.id === spaceId ? { ...item, name: nextName } : item)),
      );
    },
    [spaces],
  );

  const changeSpaceColor = useCallback(
    (spaceId: string, color: string) => {
      setSpaces(prev =>
        prev.map(item => (item.id === spaceId ? { ...item, color } : item)),
      );
    },
    [],
  );

  const deleteSpace = useCallback(
    (spaceId: string) => {
      if (spaceId === DEFAULT_SPACE_ID) {
        alert('기본 스페이스는 삭제할 수 없습니다.');
        return;
      }
      if (spaces.length <= 1) {
        alert('최소 하나의 스페이스가 있어야 합니다.');
        return;
      }
      const confirmed = window.confirm('이 스페이스와 모든 탭을 삭제하시겠습니까?');
      if (!confirmed) return;

      setSpaces(prev => prev.filter(item => item.id !== spaceId));
      setTabsBySpace(prev => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });
      setSplitStatesBySpace(prev => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });

      if (activeSpaceId === spaceId) {
        const remainingSpaces = spaces.filter(s => s.id !== spaceId);
        if (remainingSpaces.length > 0) {
          activateSpace(remainingSpaces[0].id);
        }
      }
    },
    [spaces, activeSpaceId, activateSpace],
  );

  const moveTabToSpace = useCallback(
    (tabId: string, destinationSpaceId: string, makeActive = false) => {
      if (!destinationSpaceId) return;
      setTabsBySpace(prev => {
        if (prev[destinationSpaceId] === undefined) {
          // Destination does not exist yet; abort.
          return prev;
        }
        const next: Record<string, Tab[]> = { ...prev };
        let sourceSpaceId: string | null = null;
        let sourceList: Tab[] = [];
        let destinationList: Tab[] = [...(prev[destinationSpaceId] ?? [])];
        let movedTab: Tab | null = null;

        for (const [spaceId, list] of Object.entries(prev)) {
          const index = list.findIndex(tab => tab.id === tabId);
          if (index !== -1) {
            sourceSpaceId = spaceId;
            sourceList = [...list];
            [movedTab] = sourceList.splice(index, 1);
            next[spaceId] = sourceList;
            break;
          }
        }

        if (!movedTab) {
          return prev;
        }

        if (sourceSpaceId === destinationSpaceId) {
          return prev;
        }

        if (makeActive) {
          destinationList = destinationList.map(tab => ({ ...tab, isActive: false }));
        }

        const tabToInsert: Tab = {
          ...movedTab,
          spaceId: destinationSpaceId,
          isActive: makeActive ? true : false,
        };

        destinationList.push(tabToInsert);
        next[destinationSpaceId] = reorderTabs(destinationList);

        if (sourceSpaceId) {
          if (sourceList.length === 0) {
            const resolvedHomeUrl = homePageUrl || DEFAULT_HOME_URL;
            next[sourceSpaceId] = [
              createTabState({
                isActive: true,
                url: resolvedHomeUrl,
                title: DEFAULT_HOME_TITLE,
                spaceId: sourceSpaceId,
                history: resolvedHomeUrl ? [resolvedHomeUrl] : [],
              }),
            ];
          } else if (!sourceList.some(tab => tab.isActive)) {
            const lastIndex = sourceList.length - 1;
            sourceList[lastIndex] = { ...sourceList[lastIndex], isActive: true };
            next[sourceSpaceId] = reorderTabs(sourceList);
          } else {
            next[sourceSpaceId] = sourceList;
          }
          reconcileSplitState(sourceSpaceId, next[sourceSpaceId]);
        }

        reconcileSplitState(destinationSpaceId, next[destinationSpaceId]);

        return next;
      });
      if (makeActive) {
        activateSpace(destinationSpaceId);
      }
    },
    [activateSpace, homePageUrl, reconcileSplitState, reorderTabs],
  );

  const reorderTabsInSpace = useCallback(
    (spaceId: string, fromIndex: number, toIndex: number) => {
      setTabsBySpace(prev => {
        const spaceTabs = prev[spaceId];
        if (!spaceTabs || fromIndex === toIndex) return prev;

        const newTabs = [...spaceTabs];
        const [movedTab] = newTabs.splice(fromIndex, 1);
        newTabs.splice(toIndex, 0, movedTab);

        return {
          ...prev,
          [spaceId]: newTabs,
        };
      });
    },
    [],
  );

  const toggleSplitView = useCallback(() => {
    const split = getSplitState(activeSpaceId);
    if (split.isSplit) {
      updateSplitState(activeSpaceId, state => ({
        ...state,
        isSplit: false,
        focus: 'primary',
      }));
      return;
    }
    const primaryCandidate = tabs.find(tab => tab.isActive)?.id ?? tabs[0]?.id ?? null;
    const secondaryCandidate = tabs.find(tab => tab.id !== primaryCandidate)?.id ?? null;
    updateSplitState(activeSpaceId, state => ({
      isSplit: true,
      primaryTabId: primaryCandidate,
      secondaryTabId: secondaryCandidate,
      focus: secondaryCandidate ? 'primary' : 'primary',
      ratio: state.ratio ?? DEFAULT_SPLIT_RATIO,
    }));
    reconcileSplitState(activeSpaceId, tabs);
  }, [activeSpaceId, getSplitState, reconcileSplitState, tabs, updateSplitState]);

  const setActiveTab = useCallback(
    (id: string) => {
      const target = allTabs.find(tab => tab.id === id);
      if (!target) return;
      const spaceId = target.spaceId;
      setActiveSpaceId(spaceId);
      let nextList: Tab[] | null = null;
      updateTabsForSpace(spaceId, list => {
        nextList = list.map(tab => ({
          ...tab,
          isActive: tab.id === id,
        }));
        return nextList;
      });
      const split = getSplitState(spaceId);
      if (split.isSplit) {
        updateSplitState(spaceId, state => {
          if (!state.isSplit) return state;
          if (state.primaryTabId === id) {
            return {
              ...state,
              focus: 'primary',
            };
          }
          if (state.secondaryTabId === id) {
            return {
              ...state,
              focus: 'secondary',
            };
          }
          if (state.focus === 'secondary') {
            return {
              ...state,
              secondaryTabId: id,
              focus: 'secondary',
            };
          }
          return {
            ...state,
            primaryTabId: id,
            focus: 'primary',
          };
        });
        if (nextList) {
          reconcileSplitState(spaceId, nextList);
        }
      }
    },
    [allTabs, getSplitState, reconcileSplitState, updateSplitState, updateTabsForSpace],
  );

  const focusSplitPane = useCallback(
    (slot: 'primary' | 'secondary') => {
      const split = getSplitState(activeSpaceId);
      if (!split.isSplit) return;
      if (slot === 'secondary' && !split.secondaryTabId) return;
      updateSplitState(activeSpaceId, state => {
        if (!state.isSplit) return state;
        return {
          ...state,
          focus: slot,
        };
      });
      const targetTabId = slot === 'primary' ? split.primaryTabId : split.secondaryTabId;
      if (targetTabId) {
        setActiveTab(targetTabId);
      }
    },
    [activeSpaceId, getSplitState, setActiveTab, updateSplitState],
  );

  const swapSplitPanes = useCallback(() => {
    const split = getSplitState(activeSpaceId);
    if (!split.isSplit || !split.primaryTabId || !split.secondaryTabId) return;
    updateSplitState(activeSpaceId, state => {
      if (!state.isSplit || !state.primaryTabId || !state.secondaryTabId) return state;
      return {
        ...state,
        primaryTabId: state.secondaryTabId,
        secondaryTabId: state.primaryTabId,
        focus: state.focus === 'primary' ? 'secondary' : 'primary',
      };
    });
  }, [activeSpaceId, getSplitState, updateSplitState]);

  const handleSplitResizerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const split = getSplitState(activeSpaceId);
      if (!split.isSplit) return;
      event.preventDefault();
      splitResizerActiveRef.current = true;
      splitResizerStartXRef.current = event.clientX;
      splitResizerStartRatioRef.current = split.ratio ?? DEFAULT_SPLIT_RATIO;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!splitResizerActiveRef.current) return;
        const container = document.querySelector('.browser-view');
        if (!container) return;
        const bounds = (container as HTMLElement).getBoundingClientRect();
        const delta = moveEvent.clientX - splitResizerStartXRef.current;
        const nextRatio = clampSplitRatio(
          splitResizerStartRatioRef.current + delta / Math.max(bounds.width, 1),
        );
        updateSplitState(activeSpaceId, state => ({
          ...state,
          ratio: nextRatio,
        }));
      };

      const handlePointerUp = () => {
        splitResizerActiveRef.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp as EventListener);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp as EventListener, { once: true });
    },
    [activeSpaceId, getSplitState, updateSplitState],
  );

  const updateTabById = useCallback(
    (tabId: string, updater: (tab: Tab) => Tab) => {
      setTabsBySpace(prev => {
        let targetSpaceId: string | null = null;
        let targetIndex = -1;
        let targetTab: Tab | null = null;

        for (const [spaceId, list] of Object.entries(prev)) {
          const index = list.findIndex(tab => tab.id === tabId);
          if (index !== -1) {
            targetSpaceId = spaceId;
            targetIndex = index;
            targetTab = list[index];
            break;
          }
        }

        if (!targetTab || !targetSpaceId || targetIndex === -1) {
          return prev;
        }

        const nextTab = updater(targetTab);
        if (nextTab === targetTab) {
          return prev;
        }

        const nextRecord: Record<string, Tab[]> = { ...prev };
        const sourceList = [...(prev[targetSpaceId] ?? [])];

        if (nextTab.spaceId && nextTab.spaceId !== targetSpaceId) {
          sourceList.splice(targetIndex, 1);
          nextRecord[targetSpaceId] = sourceList;
          const destinationList = [...(prev[nextTab.spaceId] ?? [])];
          destinationList.push(nextTab);
          nextRecord[nextTab.spaceId] = destinationList;
        } else {
          sourceList[targetIndex] = nextTab;
          nextRecord[targetSpaceId] = sourceList;
        }

        return nextRecord;
      });
    },
    [],
  );

  const updateAssistantMessageForRun = useCallback(
    (tabId: string | null, runId: string, updater: (message: TabAIMessage) => TabAIMessage) => {
      if (!tabId) return;
      const messageId = runAssistantMessageMapRef.current.get(runId);
      if (!messageId) return;
      updateTabById(tabId, tab => {
        if (!tab.aiContext) return tab;
        const nextMessages = tab.aiContext.messages.map(message =>
          message.id === messageId ? updater({ ...message }) : message,
        );
        return {
          ...tab,
          aiContext: {
            ...tab.aiContext,
            messages: nextMessages,
            lastUsedAt: Date.now(),
          },
        };
      });
    },
    [updateTabById],
  );

  const startAutomationForMessage = useCallback(
    async ({
      tabId,
      assistantMessageId,
      prompt,
      selection,
      mode,
    }: {
      tabId: string;
      assistantMessageId: string;
      prompt: string;
      selection?: string;
      mode: 'auto' | 'agent_thinking' | 'agent_fast';
    }) => {
      const automationBridge = window.sylph?.ai?.automation;
      if (!automationBridge?.startRun) {
        throw new Error('Automation bridge unavailable. Please reload the app.');
      }

      const sourceTab = tabs.find(tab => tab.id === tabId);

      updateTabById(tabId, tab => {
        if (!tab.aiContext) return tab;
        const nextMessages = tab.aiContext.messages.map(message =>
          message.id === assistantMessageId
            ? {
                ...message,
                status: 'pending' as const,
              }
            : message,
        );
        return {
          ...tab,
          aiContext: {
            ...tab.aiContext,
            messages: nextMessages,
            lastUsedAt: Date.now(),
          },
        };
      });

      const startResult = await automationBridge.startRun({
        prompt,
        tabId,
        mode,
        context: {
          url: sourceTab?.url,
          title: sourceTab?.title,
          selection: selection || undefined,
        },
      });

      if (!startResult.success || !startResult.run) {
        throw new Error(startResult.error ?? 'Failed to start Sylph Aether run.');
      }

      const runId = startResult.run.id;
      runAssistantMessageMapRef.current.set(runId, assistantMessageId);
      assistantMessageMetaRef.current.set(assistantMessageId, { prompt, selection });
      const normalizedMode = mode === 'agent_thinking' || mode === 'agent_fast' ? mode : 'auto';
      automationRunModeRef.current.set(runId, normalizedMode);

      updateAssistantMessageForRun(tabId, runId, message => ({
        ...message,
        runId,
        status: 'pending',
      }));

      const pendingBuffer = pendingChatBuffersRef.current.get(runId);
      const pendingFinal = pendingChatFinalRef.current.get(runId);
      if (pendingBuffer || pendingFinal) {
        updateAssistantMessageForRun(tabId, runId, message => ({
          ...message,
          content: pendingFinal?.content ?? `${message.content ?? ''}${pendingBuffer ?? ''}`,
          status: pendingFinal?.status ?? 'pending',
        }));
        if (pendingFinal) pendingChatFinalRef.current.delete(runId);
        if (pendingBuffer) pendingChatBuffersRef.current.delete(runId);
      }

      return startResult.run;
    },
    [tabs, updateAssistantMessageForRun, updateTabById],
  );
  const activeTab = useMemo(() => tabs.find(tab => tab.isActive), [tabs]);
  const activeAiMessages = activeTab?.aiContext?.messages ?? [];
  const activeSelectedText = activeTab?.aiContext?.selectedText;
  const automationRunsById = useMemo(() => {
    const map = new Map<string, AetherAutomationRun>();
    const runs = activeTab?.automation?.runs ?? [];
    runs.forEach(run => map.set(run.id, run));
    return map;
  }, [activeTab?.automation]);
  const activeAutomation = useMemo(() => {
    const automation = activeTab?.automation;
    if (!automation?.activeRunId) return null;
    return automation.runs.find(run => run.id === automation.activeRunId) ?? null;
  }, [activeTab?.automation]);
  const pendingApprovalStep = useMemo(() => {
    if (!activeAutomation) return null;
    return (
      activeAutomation.steps.find(
        step =>
          step.requiresApproval &&
          (step.status === 'pending' || step.status === 'awaiting-approval'),
      ) ?? null
    );
  }, [activeAutomation]);

  const isAutomationActive = useMemo(() => {
    if (!activeAutomation) return false;
    return !isTerminalStatus(activeAutomation.status);
  }, [activeAutomation]);

  const activePassGuard = useMemo(
    () => activeTab?.passGuard ?? createDefaultPassGuardState(),
    [activeTab],
  );

  const activeHostname = useMemo(() => extractHostname(activeTab?.url), [activeTab?.url]);

  const passGuardTooltip = useMemo(() => {
    const reasonText = activePassGuard.reason ? ` — ${activePassGuard.reason}` : '';
    const mode =
      activePassGuard.source === 'manual'
        ? activePassGuard.active
          ? '수동 활성화됨'
          : '수동 비활성화됨'
        : activePassGuard.active
        ? '자동 활성화됨'
        : '비활성화됨';
    return `PassGuard ${mode}${reasonText}. 클릭하면 PassGuard 제어판을 엽니다.`;
  }, [activePassGuard]);
  const isManualOverride = activePassGuard.source === 'manual';
  const manualSwitchChecked = Boolean(activePassGuard.active);
  const canResetManual = Boolean(activePassGuard.userOverride);
  const adblockEnabled = adblockState?.enabled ?? true;
  const adblockRecentBlocked = adblockState?.recentBlocked ?? [];
  const adblockTotalBlocked = adblockState?.totalBlocked ?? 0;
  const adblockButtonTitle = useMemo(() => {
    const totalText = adblockTotalBlocked > 0 ? `차단 ${adblockTotalBlocked}건` : '차단 없음';
    return adblockEnabled ? `Adblocker 활성화 — ${totalText}` : 'Adblocker 비활성화됨';
  }, [adblockEnabled, adblockTotalBlocked]);
  const hasActiveWebview = Boolean(activeWebviewRef.current);

  const currentAutomationStep = useMemo(() => {
    if (!activeAutomation) return null;
    return (
      activeAutomation.steps.find(step => step.status === 'running') ??
      activeAutomation.steps.find(step => step.status === 'pending') ??
      activeAutomation.steps.find(step => step.status === 'awaiting-approval') ??
      null
    );
  }, [activeAutomation]);

  const activeSplit = useMemo(
    () => getSplitState(activeSpaceId),
    [activeSpaceId, getSplitState],
  );

  const ratio = clampSplitRatio(activeSplit.ratio ?? DEFAULT_SPLIT_RATIO);
  const primaryCandidateId = activeSplit.isSplit
    ? activeSplit.primaryTabId ?? activeTab?.id ?? tabs[0]?.id ?? null
    : activeTab?.id ?? tabs[0]?.id ?? null;
  let primaryTab = primaryCandidateId
    ? tabs.find(tab => tab.id === primaryCandidateId) ?? null
    : null;
  if (!primaryTab && tabs.length > 0) {
    primaryTab = tabs[0];
  }
  const secondaryTabId = activeSplit.isSplit ? activeSplit.secondaryTabId ?? null : null;
  const secondaryTab =
    secondaryTabId && tabs.some(tab => tab.id === secondaryTabId)
      ? tabs.find(tab => tab.id === secondaryTabId) ?? null
      : null;
  const browserViewStyle = activeSplit.isSplit
    ? ({
        '--primary-width': `${(ratio * 100).toFixed(2)}%`,
        '--secondary-width': `${((1 - ratio) * 100).toFixed(2)}%`,
        '--split-gap': '18px',
      } as React.CSSProperties)
    : undefined;
  const canSplit = tabs.length > 1;

  useEffect(() => {
    if (!activeTab) {
      setAddressValue('');
      return;
    }

    if (!isAddressFocused) {
      setAddressValue(activeTab.url);
    }
  }, [activeTab?.id, activeTab?.url, isAddressFocused]);

  useEffect(() => {
    activeTabIdRef.current = activeTab?.id ?? null;
    activeWebviewRef.current = activeTab
      ? webviewsRef.current.get(activeTab.id) ?? null
      : null;
  }, [activeTab?.id]);

  useEffect(() => {
    latestAddressFocusRef.current = isAddressFocused;
  }, [isAddressFocused]);

  useEffect(() => {
    const handleGlobalClick = () => setSpaceMenuTabId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
    };
  }, []);

  useEffect(() => {
    setSpaceMenuTabId(null);
  }, [activeSpaceId]);

  useEffect(() => {
    ensureSpaceHasActiveTab(activeSpaceId);
  }, [activeSpaceId, ensureSpaceHasActiveTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedWidth = window.localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY);
      if (storedWidth) {
        const parsedWidth = Number.parseInt(storedWidth, 10);
        if (!Number.isNaN(parsedWidth)) {
          setAiPanelWidth(clampAiPanelWidth(parsedWidth));
        }
      }
      const storedCollapsed = window.localStorage.getItem(AI_PANEL_COLLAPSED_STORAGE_KEY);
      if (storedCollapsed === '1') {
        setIsAiCollapsed(true);
      }
    } catch (error) {
      console.warn('Failed to restore Aether panel preferences', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(aiPanelWidth));
    } catch (error) {
      console.warn('Failed to persist Aether panel width', error);
    }
  }, [aiPanelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_PANEL_COLLAPSED_STORAGE_KEY, isAiCollapsed ? '1' : '0');
    } catch (error) {
      console.warn('Failed to persist Aether panel state', error);
    }
  }, [isAiCollapsed]);

  useEffect(() => {
    let cancelled = false;
    const fetchHome = async () => {
      try {
        const url = await window.sylph?.getHomePageUrl?.();
        if (cancelled) return;
        const resolvedUrl = url || DEFAULT_HOME_URL;
        setHomePageUrl(resolvedUrl);
        setTabsBySpace(prev => {
          const defaultSpaceTabs = prev[DEFAULT_SPACE_ID] || [];
          if (defaultSpaceTabs.length === 0) {
            return {
              ...prev,
              [DEFAULT_SPACE_ID]: [
                createTabState({
                  isActive: true,
                  url: resolvedUrl,
                  title: DEFAULT_HOME_TITLE,
                  spaceId: DEFAULT_SPACE_ID,
                  history: resolvedUrl && resolvedUrl !== 'about:blank' ? [resolvedUrl] : [],
                }),
              ],
            };
          }
          let mutated = false;
          const next: Record<string, Tab[]> = {};
          for (const [spaceId, list] of Object.entries(prev)) {
            let spaceMutated = false;
            const mapped = list.map(tab => {
              if ((tab.url === '' || tab.url === DEFAULT_HOME_URL) && tab.history.length <= 1) {
                spaceMutated = true;
                return {
                  ...tab,
                  url: resolvedUrl,
                  title: DEFAULT_HOME_TITLE,
                  history: resolvedUrl && resolvedUrl !== 'about:blank' ? [resolvedUrl] : [],
                  updatedAt: Date.now(),
                };
              }
              return tab;
            });
            if (spaceMutated) {
              mutated = true;
              next[spaceId] = mapped;
            } else {
              next[spaceId] = list;
            }
          }
          return mutated ? next : prev;
        });
      } catch (error) {
        console.error('Failed to resolve home page URL', error);
        setTabsBySpace(prev => {
          const defaultSpaceTabs = prev[DEFAULT_SPACE_ID] || [];
          if (defaultSpaceTabs.length === 0) {
            return {
              ...prev,
              [DEFAULT_SPACE_ID]: [
                createTabState({
                  isActive: true,
                  url: DEFAULT_HOME_URL,
                  title: DEFAULT_HOME_TITLE,
                  spaceId: DEFAULT_SPACE_ID,
                  history: [],
                }),
              ],
            };
          }
          return prev;
        });
      }
    };

    fetchHome();

    return () => {
      cancelled = true;
    };
  }, []);

  const snapshotTab = useCallback(
    (tab: Tab): TabSnapshot => ({
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      history: [...tab.history],
      spaceId: tab.spaceId,
      isPinned: tab.isPinned,
      incognito: tab.incognito,
      isMuted: tab.isMuted,
      aiContext: cloneAiContext(tab.aiContext),
      automation: cloneAutomationState(tab.automation),
      passGuard: clonePassGuardState(tab.passGuard),
    }),
    [],
  );

  const pushClosedTab = useCallback(
    (tab: Tab) => {
      const snapshot = snapshotTab(tab);
      closedTabsRef.current = [snapshot, ...closedTabsRef.current].slice(0, 50);
    },
    [snapshotTab],
  );

  const createTab = useCallback((options?: CreateTabOptions) => {
    const resolvedHomeUrl = homePageUrl || DEFAULT_HOME_URL;
    const makeActive = options?.makeActive ?? true;
    const initial = options?.initialState ?? {};
    const hasCustomUrl = Boolean(options?.url ?? initial.url);

    // Determine profileId and check if it's incognito
    const tabProfileId = options?.profileId ?? initial.profileId ?? activeProfileId;
    const profile = profiles.find(p => p.id === tabProfileId);
    const isIncognitoProfile = profile?.isIncognito ?? false;

    const url = options?.url ?? initial.url ?? (isIncognitoProfile ? 'incognito.html' : resolvedHomeUrl) ?? '';
    const title =
      options?.title ??
      initial.title ??
      (hasCustomUrl ? (url || 'New Tab') : DEFAULT_HOME_TITLE);
    const history = initial.history ? [...initial.history] : url ? [url] : [];

    const nextTab = createTabState({
      ...initial,
      url,
      title,
      spaceId: options?.spaceId ?? initial.spaceId ?? activeSpaceId,
      profileId: tabProfileId,
      isActive: makeActive,
      isLoading: makeActive && Boolean(url) && !initial.history,
      history,
      favicon: initial.favicon,
      isPinned: initial.isPinned,
      incognito: options?.incognito ?? initial.incognito ?? isIncognitoProfile,
      isMuted: initial.isMuted,
      aiContext: initial.aiContext ? { ...initial.aiContext } : undefined,
    });

    updateTabsForSpace(nextTab.spaceId, current => {
      const base = makeActive
        ? current.map(tab => ({ ...tab, isActive: false }))
        : [...current];
      const insertIndex = options?.insertIndex ?? base.length;
      const clampedIndex = Math.min(Math.max(insertIndex, 0), base.length);
      base.splice(clampedIndex, 0, nextTab);
      reconcileSplitState(nextTab.spaceId, base);
      return base;
    });
    if (makeActive) {
      setActiveSpaceId(nextTab.spaceId);
      const split = getSplitState(nextTab.spaceId);
      if (split.isSplit) {
        updateSplitState(nextTab.spaceId, state => {
          if (!state.isSplit) return state;
          if (state.focus === 'secondary') {
            return {
              ...state,
              secondaryTabId: nextTab.id,
              focus: 'secondary',
            };
          }
          return {
            ...state,
            primaryTabId: nextTab.id,
            focus: 'primary',
          };
        });
      }
    }
    return nextTab.id;
  }, [activeSpaceId, activeProfileId, profiles, getSplitState, homePageUrl, reconcileSplitState, updateSplitState, updateTabsForSpace]);

  // Initialize profile window with a tab if it's a new incognito profile
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;

    const currentProfile = profiles.find(p => p.id === activeProfileId);
    if (!currentProfile) return;

    // Only auto-create tab if this is an incognito profile and there are no tabs
    if (currentProfile.isIncognito && tabs.length === 0) {
      createTab({
        url: 'incognito.html',
        title: 'New Incognito Tab',
        makeActive: true,
        profileId: activeProfileId,
        incognito: true,
      });
      hasInitialized.current = true;
    }
  }, [activeProfileId, profiles, tabs, createTab]);

  const closeTab = useCallback(
    (id: string) => {
      const resolvedHomeUrl = homePageUrl || DEFAULT_HOME_URL;
      const closing = allTabs.find(tab => tab.id === id);
      if (closing) {
        pushClosedTab(closing);
      }
      const targetSpaceId = closing?.spaceId ?? activeSpaceId ?? DEFAULT_SPACE_ID;
      updateTabsForSpace(targetSpaceId, list => {
        const filtered = list.filter(tab => tab.id !== id);
        if (filtered.length === list.length) {
          return list;
        }
        if (filtered.length === 0) {
          updateSplitState(targetSpaceId, () => createDefaultSplitState());
          return [
            createTabState({
              isActive: true,
              url: resolvedHomeUrl,
              title: DEFAULT_HOME_TITLE,
              spaceId: targetSpaceId,
              history: resolvedHomeUrl ? [resolvedHomeUrl] : [],
            }),
          ];
        }

        reconcileSplitState(targetSpaceId, filtered);

        if (!filtered.some(tab => tab.isActive)) {
          const lastIndex = filtered.length - 1;
          return filtered.map((tab, index) => ({
            ...tab,
            isActive: index === lastIndex,
          }));
        }
        return filtered;
      });
    },
    [activeSpaceId, allTabs, homePageUrl, pushClosedTab, reconcileSplitState, updateSplitState, updateTabsForSpace],
  );

  // Profile management functions
  const createProfile = useCallback((name: string, color: string) => {
    const newProfile: Profile = {
      id: `profile-${uuidv4()}`,
      name,
      color,
      partition: `persist:sylph-${uuidv4()}`,
      isIncognito: false,
      createdAt: Date.now(),
    };
    setProfiles(prev => [...prev, newProfile]);
    return newProfile;
  }, []);

  const deleteProfile = useCallback((profileId: string) => {
    if (profileId === DEFAULT_PROFILE_ID) {
      console.warn('Cannot delete default profile');
      return;
    }
    setProfiles(prev => prev.filter(p => p.id !== profileId));
    // Close all tabs using this profile
    setTabsBySpace(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(spaceId => {
        next[spaceId] = next[spaceId].filter(tab => tab.profileId !== profileId);
      });
      return next;
    });
  }, []);

  const createIncognitoTab = useCallback(() => {
    const incognitoProfile = createIncognitoProfile();
    setProfiles(prev => [...prev, incognitoProfile]);

    // Open incognito profile in new window
    window.sylph?.openProfileWindow(incognitoProfile.id);
  }, []);

  // Archive management functions
  const archiveTab = useCallback((tab: Tab) => {
    const archived: ArchivedTab = {
      id: uuidv4(),
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      spaceId: tab.spaceId,
      archivedAt: Date.now(),
      lastAccessedAt: tab.updatedAt,
    };

    setArchivedTabs(prev => {
      const updated = [archived, ...prev];
      // Keep only the most recent maxArchivedTabs
      if (updated.length > archiveSettings.maxArchivedTabs) {
        return updated.slice(0, archiveSettings.maxArchivedTabs);
      }
      return updated;
    });

    // Close the tab
    closeTab(tab.id);
  }, [archiveSettings.maxArchivedTabs, closeTab]);

  const restoreArchivedTab = useCallback((archivedTab: ArchivedTab) => {
    // Remove from archived list
    setArchivedTabs(prev => prev.filter(t => t.id !== archivedTab.id));

    // Create new tab
    createTab({
      url: archivedTab.url,
      title: archivedTab.title,
      spaceId: archivedTab.spaceId,
      makeActive: true,
    });
  }, [createTab]);

  const clearArchivedTabs = useCallback(() => {
    setArchivedTabs([]);
  }, []);

  // Auto-archive inactive tabs
  useEffect(() => {
    if (!archiveSettings.enabled) {
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const inactiveThreshold = archiveSettings.autoArchiveAfterMinutes * 60 * 1000;

      Object.entries(tabsBySpace).forEach(([, spaceTabs]) => {
        spaceTabs.forEach(tab => {
          const timeSinceUpdate = now - tab.updatedAt;
          const isInactive = timeSinceUpdate > inactiveThreshold;
          const isNotActive = !tab.isActive;
          const isNotPinned = !tab.isPinned;

          if (isInactive && isNotActive && isNotPinned) {
            console.log(`Auto-archiving inactive tab: ${tab.title}`);
            archiveTab(tab);
          }
        });
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [archiveSettings.enabled, archiveSettings.autoArchiveAfterMinutes, tabsBySpace, archiveTab]);

  // Close profile menu on outside click
  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-menu')) {
        setIsProfileMenuOpen(false);
      }
    };
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('click', handleClick);
    };
  }, [isProfileMenuOpen]);

  const closeOtherTabs = useCallback(
    (targetId: string) => {
      const target = allTabs.find(tab => tab.id === targetId);
      if (!target) return;
      activateSpace(target.spaceId);
      updateTabsForSpace(target.spaceId, list => {
        const toClose = list.filter(tab => tab.id !== targetId && !tab.isPinned);
        if (toClose.length === 0) {
          return list.map(tab => ({
            ...tab,
            isActive: tab.id === targetId,
          }));
        }
        toClose.forEach(pushClosedTab);
        const survivors = list
          .filter(tab => tab.id === targetId || tab.isPinned)
          .map(tab => ({
            ...tab,
            isActive: tab.id === targetId,
          }));
        reconcileSplitState(target.spaceId, survivors);
        return reorderTabs(survivors);
      });
    },
    [activateSpace, allTabs, pushClosedTab, reconcileSplitState, reorderTabs, updateTabsForSpace],
  );

  const closeTabsToRight = useCallback(
    (targetId: string) => {
      const target = allTabs.find(tab => tab.id === targetId);
      if (!target) return;
      activateSpace(target.spaceId);
      updateTabsForSpace(target.spaceId, list => {
        const targetIndex = list.findIndex(tab => tab.id === targetId);
        if (targetIndex === -1) return list;
        const toClose = list.filter(
          (tab, index) => index > targetIndex && !tab.isPinned,
        );
        if (toClose.length === 0) {
          return list.map(tab => ({
            ...tab,
            isActive: tab.id === targetId,
          }));
        }
        toClose.forEach(pushClosedTab);
        const survivors = list
          .filter((tab, index) => index <= targetIndex || tab.isPinned)
          .map(tab => ({
            ...tab,
            isActive: tab.id === targetId,
          }));
        reconcileSplitState(target.spaceId, survivors);
        return reorderTabs(survivors);
      });
    },
    [activateSpace, allTabs, pushClosedTab, reconcileSplitState, reorderTabs, updateTabsForSpace],
  );

  const duplicateTab = useCallback((tabId: string) => {
    const source = allTabs.find(tab => tab.id === tabId);
    if (!source) return;
    const spaceId = source.spaceId;
    const duplicated = createTabState({
      ...snapshotTab(source),
      isPinned: source.isPinned,
      isActive: true,
      spaceId,
    });
    updateTabsForSpace(spaceId, list => {
      const index = list.findIndex(tab => tab.id === tabId);
      if (index === -1) return list;
      const updated = list.map(tab => ({ ...tab, isActive: false }));
      updated.splice(index + 1, 0, duplicated);
      return reorderTabs(updated);
    });
    setActiveSpaceId(spaceId);
  }, [allTabs, reorderTabs, snapshotTab, updateTabsForSpace]);

  const toggleTabPin = useCallback(
    (tabId: string, shouldPin: boolean) => {
      const target = allTabs.find(tab => tab.id === tabId);
      if (!target) return;
      updateTabsForSpace(target.spaceId, list => {
        if (!list.some(tab => tab.id === tabId)) return list;
        const updated = list.map(tab =>
          tab.id === tabId ? { ...tab, isPinned: shouldPin } : tab,
        );
        return reorderTabs(updated);
      });
    },
    [allTabs, reorderTabs, updateTabsForSpace],
  );

  const reopenClosedTab = useCallback(() => {
    const [snapshot, ...rest] = closedTabsRef.current;
    if (!snapshot) return;
    closedTabsRef.current = rest;
    const reopened = createTabState({
      ...snapshot,
      isActive: true,
    });
    updateTabsForSpace(reopened.spaceId, list => {
      const base = list.map(tab => ({ ...tab, isActive: false }));
      base.push(reopened);
      return reorderTabs(base);
    });
    setActiveSpaceId(reopened.spaceId);
  }, [reorderTabs, updateTabsForSpace]);

  const selectAdjacentTab = useCallback(
    (direction: 'next' | 'previous') => {
      const currentTabs = tabs;
      if (currentTabs.length <= 1) return;
      const activeIndex = currentTabs.findIndex(tab => tab.isActive);
      if (activeIndex === -1) return;
      const offset = direction === 'next' ? 1 : -1;
      const nextIndex =
        (activeIndex + offset + currentTabs.length) % currentTabs.length;
      if (nextIndex === activeIndex) return;
      updateTabsForSpace(activeSpaceId, list =>
        list.map((tab, index) => ({
          ...tab,
          isActive: index === nextIndex,
        })),
      );
    },
    [activeSpaceId, tabs, updateTabsForSpace],
  );

  const normalizeUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
    if (hasScheme) return trimmed;
    const looksLikeSearch = trimmed.includes(' ') || !trimmed.includes('.');
    if (looksLikeSearch) {
      const params = new URLSearchParams({ q: trimmed });
      return `https://www.google.com/search?${params.toString()}`;
    }
    return `https://${trimmed}`;
  };

  const handleNavigate = useCallback(() => {
    if (!activeTab) return;
    const normalized = normalizeUrl(addressValue);
    if (!normalized) return;

    if (activeTab.url === normalized) {
      activeWebviewRef.current?.reload();
      addressInputRef.current?.blur();
      return;
    }

    setAddressValue(normalized);
    updateTabById(activeTab.id, tab => ({
      ...tab,
      url: normalized,
      title: normalized,
      isLoading: true,
      updatedAt: Date.now(),
    }));

    // Mark this as a typed URL for better autocomplete ranking
    addToHistory(normalized, normalized, undefined, true);

    addressInputRef.current?.blur();
  }, [activeTab, addressValue, addToHistory, updateTabById]);

  const handleAddressKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // If a suggestion is selected, use it
      if (selectedSuggestionIndex >= 0 && addressSuggestions[selectedSuggestionIndex]) {
        const suggestion = addressSuggestions[selectedSuggestionIndex];
        setAddressValue(suggestion.url);
        setAddressSuggestions([]);
        setSelectedSuggestionIndex(-1);
        // Navigate to the selected suggestion
        if (!activeTab) return;
        updateTabById(activeTab.id, tab => ({
          ...tab,
          url: suggestion.url,
          title: suggestion.title,
          isLoading: true,
          updatedAt: Date.now(),
        }));
        addressInputRef.current?.blur();
      } else {
        handleNavigate();
      }
    }
    if (event.key === 'Escape') {
      setAddressSuggestions([]);
      setSelectedSuggestionIndex(-1);
      event.currentTarget.blur();
    }
    if (event.key === 'Tab' && addressSuggestions.length > 0) {
      event.preventDefault();
      // Cycle through suggestions with Tab
      const nextIndex = (selectedSuggestionIndex + 1) % addressSuggestions.length;
      setSelectedSuggestionIndex(nextIndex);
      setAddressValue(addressSuggestions[nextIndex].url);
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (addressSuggestions.length > 0) {
        const nextIndex = Math.min(selectedSuggestionIndex + 1, addressSuggestions.length - 1);
        setSelectedSuggestionIndex(nextIndex);
        if (nextIndex >= 0) {
          setAddressValue(addressSuggestions[nextIndex].url);
        }
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (addressSuggestions.length > 0) {
        const nextIndex = Math.max(selectedSuggestionIndex - 1, -1);
        setSelectedSuggestionIndex(nextIndex);
        if (nextIndex >= 0) {
          setAddressValue(addressSuggestions[nextIndex].url);
        } else {
          // Reset to original input when going back past the first suggestion
          setAddressValue('');
        }
      }
    }
  };

  const handleGoBack = () => {
    if (!activeWebviewRef.current || !activeTab?.canGoBack) return;
    activeWebviewRef.current.goBack();
  };

  const handleGoForward = () => {
    if (!activeWebviewRef.current || !activeTab?.canGoForward) return;
    activeWebviewRef.current.goForward();
  };

  const handleReload = () => {
    activeWebviewRef.current?.reload();
  };

  const handleManualPassGuardChange = useCallback(
    (nextActive: boolean) => {
      const tabId = activeTabIdRef.current;
      if (!tabId) return;
      updateTabById(tabId, tab => {
        const current = tab.passGuard ?? createDefaultPassGuardState();
        if (current.source === 'manual' && current.active === nextActive) {
          if (current.userOverride === (nextActive ? 'on' : 'off')) {
            return tab;
          }
        }
        return {
          ...tab,
          passGuard: {
            active: nextActive,
            source: 'manual',
            reason: nextActive ? '사용자 직접 활성화' : '사용자 직접 비활성화',
            userOverride: nextActive ? 'on' : 'off',
          },
        };
      });
    },
    [updateTabById],
  );

  const handleManualPassGuardReset = useCallback(() => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    updateTabById(tabId, tab => {
      const current = clonePassGuardState(tab.passGuard) ?? createDefaultPassGuardState();
      if (!current.userOverride) return tab;
      const nextState = resolvePassGuardState(
        {
          ...tab,
          passGuard: {
            ...current,
            userOverride: undefined,
          },
        },
        tab.url,
        passGuardSettings,
      );
      return {
        ...tab,
        passGuard: nextState,
      };
    });
  }, [passGuardSettings, updateTabById]);

  const handleTogglePassGuardPanel = useCallback(() => {
    setIsPassGuardPanelOpen(prev => !prev);
  }, []);

  const handleAutoDetectionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ autoDetectionEnabled: event.target.checked });
    },
    [updatePassGuardSettings],
  );

  const handleIncludeDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setPassGuardIncludeDraft(value);
      updatePassGuardSettings({ includeHosts: parseHostInput(value) });
    },
    [updatePassGuardSettings],
  );

  const handleExcludeDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setPassGuardExcludeDraft(value);
      updatePassGuardSettings({ excludeHosts: parseHostInput(value) });
    },
    [updatePassGuardSettings],
  );

  const handleCustomUserAgentChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ customUserAgent: event.target.value });
    },
    [updatePassGuardSettings],
  );

  const handleCustomPlatformChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ customPlatform: event.target.value });
    },
    [updatePassGuardSettings],
  );

  const handleCustomVendorChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ customVendor: event.target.value });
    },
    [updatePassGuardSettings],
  );

  const handleCustomProductSubChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ customProductSub: event.target.value });
    },
    [updatePassGuardSettings],
  );

  const handleCustomAppVersionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ customAppVersion: event.target.value });
    },
    [updatePassGuardSettings],
  );

  const handleRemoveUserAgentDataChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      updatePassGuardSettings({ removeUserAgentData: event.target.checked });
    },
    [updatePassGuardSettings],
  );

  const handleIncludeHostAdd = useCallback(() => {
    const host = activeHostname;
    if (!host) return;
    updatePassGuardSettings(current => ({
      includeHosts: sanitizeHostList([...current.includeHosts, host]),
      excludeHosts: current.excludeHosts.filter(item => item !== host),
    }));
  }, [activeHostname, updatePassGuardSettings]);

  const handleExcludeHostAdd = useCallback(() => {
    const host = activeHostname;
    if (!host) return;
    updatePassGuardSettings(current => ({
      excludeHosts: sanitizeHostList([...current.excludeHosts, host]),
      includeHosts: current.includeHosts.filter(item => item !== host),
    }));
  }, [activeHostname, updatePassGuardSettings]);

  const handleToggleAdblockPanel = useCallback(() => {
    setIsAdblockPanelOpen(previous => {
      const next = !previous;
      if (!previous) {
        void refreshAdblockState();
      } else if (isAdblockPickerActive) {
        cancelAdblockElementPicker();
      }
      return next;
    });
  }, [cancelAdblockElementPicker, isAdblockPickerActive, refreshAdblockState]);

  const handleAdblockToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!window.sylph?.adblocker?.setEnabled) return;
      setAdblockError(null);
      try {
        const state = await window.sylph.adblocker.setEnabled({ enabled });
        setAdblockState(state);
      } catch (error) {
        setAdblockError(error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );

  const handleAdblockAddRule = useCallback(async () => {
    const raw = adblockCustomRuleInput.trim();
    if (!raw) return;
    if (!window.sylph?.adblocker?.addCosmeticFilter) return;
    setAdblockError(null);
    try {
      const response = await window.sylph.adblocker.addCosmeticFilter({ rule: raw });
      if (!response.success) {
        setAdblockError(response.error ?? 'Failed to add filter.');
        return;
      }
      setAdblockCustomRuleInput('');
      if (response.state) {
        setAdblockState(response.state);
      } else {
        await refreshAdblockState();
      }
    } catch (error) {
      setAdblockError(error instanceof Error ? error.message : String(error));
    }
  }, [adblockCustomRuleInput, refreshAdblockState]);

  const handleAdblockRemoveRule = useCallback(
    async (rule: string) => {
      if (!window.sylph?.adblocker?.removeCosmeticFilter) return;
      setAdblockError(null);
      try {
        const response = await window.sylph.adblocker.removeCosmeticFilter({ rule });
        if (!response.success) {
          setAdblockError(response.error ?? 'Failed to remove filter.');
          return;
        }
        if (response.state) {
          setAdblockState(response.state);
        } else {
          await refreshAdblockState();
        }
      } catch (error) {
        setAdblockError(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshAdblockState],
  );

  const handleAdblockClearLog = useCallback(async () => {
    if (!window.sylph?.adblocker?.clearLog) return;
    setAdblockError(null);
    try {
      const state = await window.sylph.adblocker.clearLog();
      setAdblockState(state);
    } catch (error) {
      setAdblockError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleAdblockBlockElement = useCallback(async () => {
    const webview = activeWebviewRef.current;
    if (!webview || !window.sylph?.adblocker?.addCosmeticFilter) return;
    setAdblockError(null);
    setIsAdblockPickerActive(true);
    try {
      const result = await webview.executeJavaScript(ADBLOCK_PICKER_SCRIPT, true);
      if (!result || typeof result !== 'object' || !result.selector) {
        return;
      }
      const selector = String(result.selector);
      const hostname = result.hostname ? String(result.hostname) : '';
      const rule = hostname ? hostname + '##' + selector : '##' + selector;
      const response = await window.sylph.adblocker.addCosmeticFilter({ rule });
      if (!response.success) {
        setAdblockError(response.error ?? 'Failed to add custom filter.');
        return;
      }
      setAdblockSuccessMessage('요소가 차단되었습니다');
      setTimeout(() => setAdblockSuccessMessage(null), 2500);
      if (response.state) {
        setAdblockState(response.state);
      } else {
        await refreshAdblockState();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message && message !== 'null') {
        setAdblockError(message);
      }
    } finally {
      setIsAdblockPickerActive(false);
    }
  }, [refreshAdblockState]);

  const setupWebviewListeners = useCallback(
    (tabId: string, webview: WebviewTag) => {
      const updateNavigationState = () => {
        updateTabById(tabId, tab => ({
          ...tab,
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        }));
      };

      const handleDidNavigate = (event: DidNavigateEvent) => {
        const { url } = event;
        updateTabById(tabId, tab => {
          const history =
            tab.history.length === 0 || tab.history[tab.history.length - 1] !== url
              ? [...tab.history, url]
              : tab.history;
          const passGuard = resolvePassGuardState(tab, url, passGuardSettings);
          return {
            ...tab,
            url,
            history,
            passGuard,
            updatedAt: Date.now(),
            isLoading: false,
            isCrashed: false,
          };
        });
        if (activeTabIdRef.current === tabId && !latestAddressFocusRef.current) {
          setAddressValue(url);
        }
        updateNavigationState();
      };

      const handleDidNavigateInPage = (event: DidNavigateInPageEvent) => {
        const { url } = event;
        updateTabById(tabId, tab => ({
          ...tab,
          url,
          passGuard: resolvePassGuardState(tab, url, passGuardSettings),
          updatedAt: Date.now(),
        }));
        if (activeTabIdRef.current === tabId && !latestAddressFocusRef.current) {
          setAddressValue(url);
        }
        updateNavigationState();
      };

      const handleTitleUpdated = (event: PageTitleUpdatedEvent) => {
        updateTabById(tabId, tab => ({
          ...tab,
          title: event.title || tab.url || 'New Tab',
          updatedAt: Date.now(),
        }));
      };

      const handleFaviconUpdated = (event: PageFaviconUpdatedEvent) => {
        const currentUrl = webview.getURL();
        const candidate = resolveFaviconUrl(event.favicons ?? [], currentUrl);
        console.log('[Favicon] Updated for', currentUrl, 'icons:', event.favicons, 'resolved:', candidate);
        if (candidate) {
          updateTabById(tabId, tab => ({
            ...tab,
            favicon: candidate,
          }));
        }
      };

      const handleDidStartLoading = () => {
        updateTabById(tabId, tab => ({
          ...tab,
          isLoading: true,
          updatedAt: Date.now(),
        }));
      };

      const handleDidStopLoading = () => {
        updateTabById(tabId, tab => ({
          ...tab,
          isLoading: false,
          updatedAt: Date.now(),
        }));
        updateNavigationState();

        // Always try to get favicon after page loads
        const currentUrl = webview.getURL();
        const currentTitle = webview.getTitle();

        if (currentUrl && currentUrl.startsWith('http')) {
          // Use a more reliable method: inject script to get favicon from DOM
          const faviconScript = `
            (function() {
              const links = Array.from(document.querySelectorAll('link[rel*="icon"]'));
              const favicons = links
                .map(link => link.href)
                .filter(href => href && href.length > 0);
              return favicons;
            })();
          `;

          void webview.executeJavaScript(faviconScript, false)
            .then((favicons: string[]) => {
              console.log('[Favicon Script] Found icons:', favicons, 'for', currentUrl);
              const candidate = resolveFaviconUrl(favicons || [], currentUrl);
              if (candidate) {
                updateTabById(tabId, tab => ({
                  ...tab,
                  favicon: candidate,
                }));
              }
              // Add to browsing history after we have favicon
              addToHistory(currentUrl, currentTitle, candidate);
            })
            .catch(err => {
              console.warn('[Favicon Script] Failed:', err);
              // Fallback to direct favicon.ico
              const fallbackFavicon = resolveFaviconUrl([], currentUrl);
              if (fallbackFavicon) {
                updateTabById(tabId, tab => ({
                  ...tab,
                  favicon: fallbackFavicon,
                }));
              }
              // Add to browsing history even if favicon failed
              addToHistory(currentUrl, currentTitle, fallbackFavicon);
            });
        }
      };

      const handleDidFailLoad = (event: DidFailLoadEvent) => {
        if (event.errorCode === -3) {
          updateTabById(tabId, tab => ({
            ...tab,
            isLoading: false,
            isCrashed: false,
            updatedAt: Date.now(),
          }));
          return;
        }
        updateTabById(tabId, tab => ({
          ...tab,
          isLoading: false,
          isCrashed: true,
          updatedAt: Date.now(),
        }));
      };

      const handleDomReady = () => {
        updateNavigationState();
        const currentTab = tabsByIdRef.current.get(tabId);
        if (currentTab) {
          void applyPassGuardToTab(currentTab);
        }

        // Inject link click interceptor for target="_blank" links
        const linkInterceptScript = `
          (function() {
            document.addEventListener('click', function(e) {
              let target = e.target;
              // Find the closest anchor element
              while (target && target.tagName !== 'A') {
                target = target.parentElement;
              }

              if (target && target.tagName === 'A' && target.href) {
                const targetAttr = target.getAttribute('target');
                // Intercept links with target="_blank" or that open in new window
                if (targetAttr === '_blank' || targetAttr === '_new') {
                  e.preventDefault();
                  e.stopPropagation();
                  // Send message via console to host
                  console.log('[SYLPH_OPEN_NEW_TAB]', target.href);
                }
              }
            }, true);
          })();
        `;

        void webview.executeJavaScript(linkInterceptScript, true).catch(err => {
          console.warn('Failed to inject link interceptor:', err);
        });

        if (!currentTab) {
          try {
            if (typeof webview.setUserAgent === 'function') {
              webview.setUserAgent(DEFAULT_USER_AGENT);
            }
            const script = createStealthInjectionScript({
              userAgent: DEFAULT_USER_AGENT,
              platform: 'MacIntel',
              languages: PASS_GUARD_LANGUAGES,
              vendor: 'Google Inc.',
              productSub: '20030107',
              appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7)',
              removeUserAgentData: false,
            });
            void webview
              .executeJavaScript(script, true)
              .catch(error => {
                console.warn('Failed to inject stealth script', error);
              });
          } catch (error) {
            console.warn('Failed to configure stealth settings', error);
          }
        }
      };

      const handleNewWindow = (event: WebviewNewWindowEvent) => {
        console.log('[new-window] Event triggered:', event);
        event.preventDefault();
        const shouldActivate = event.disposition !== 'background-tab';
        const targetUrl = event.url ?? '';
        console.log('[new-window] Target URL:', targetUrl, 'Disposition:', event.disposition);
        if (!targetUrl) {
          return;
        }
        createTab({
          url: targetUrl,
          title: event.frameName || (targetUrl ? targetUrl : 'New Tab'),
          makeActive: shouldActivate,
        });
      };

      const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
        const { message } = event;
        // Check if this is our special console message
        if (message.startsWith('[SYLPH_OPEN_NEW_TAB]')) {
          const url = message.replace('[SYLPH_OPEN_NEW_TAB]', '').trim();
          if (url) {
            console.log('[console-message] Creating new tab with URL:', url);
            createTab({
              url,
              title: 'New Tab',
              makeActive: true,
            });
          }
        }
      };

      webview.addEventListener('did-navigate', handleDidNavigate);
      webview.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
      webview.addEventListener('page-title-updated', handleTitleUpdated);
      webview.addEventListener('page-favicon-updated', handleFaviconUpdated);
      webview.addEventListener('did-start-loading', handleDidStartLoading);
      webview.addEventListener('did-stop-loading', handleDidStopLoading);
      webview.addEventListener('did-fail-load', handleDidFailLoad);
      webview.addEventListener('dom-ready', handleDomReady);
      webview.addEventListener('new-window', handleNewWindow);
      webview.addEventListener('console-message', handleConsoleMessage);

      return () => {
        webview.removeEventListener('did-navigate', handleDidNavigate);
        webview.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
        webview.removeEventListener('page-title-updated', handleTitleUpdated);
        webview.removeEventListener('page-favicon-updated', handleFaviconUpdated);
        webview.removeEventListener('did-start-loading', handleDidStartLoading);
        webview.removeEventListener('did-stop-loading', handleDidStopLoading);
        webview.removeEventListener('did-fail-load', handleDidFailLoad);
        webview.removeEventListener('dom-ready', handleDomReady);
        webview.removeEventListener('new-window', handleNewWindow);
        webview.removeEventListener('console-message', handleConsoleMessage);
      };
    },
    [addToHistory, applyPassGuardToTab, createTab, passGuardSettings, setAddressValue, updateTabById],
  );

  const handleWebviewRef = useCallback(
    (tabId: string, element: HTMLElement | null) => {
      const webviewElement = element as WebviewTag | null;
      const webviews = webviewsRef.current;
      const listeners = webviewListenersRef.current;
      const previous = webviews.get(tabId);

      if (!webviewElement) {
        listeners.get(tabId)?.();
        listeners.delete(tabId);
        webviews.delete(tabId);
        if (activeWebviewRef.current === previous) {
          activeWebviewRef.current = null;
        }
        return;
      }

      if (previous && previous !== webviewElement) {
        listeners.get(tabId)?.();
        listeners.delete(tabId);
        webviews.delete(tabId);
        if (activeWebviewRef.current === previous) {
          activeWebviewRef.current = null;
        }
      }

      if (previous === webviewElement) {
        return;
      }

      webviews.set(tabId, webviewElement);
      if (activeTabIdRef.current === tabId) {
        activeWebviewRef.current = webviewElement;
      }
      const cleanup = setupWebviewListeners(tabId, webviewElement);
      listeners.set(tabId, cleanup);
      const currentTab = tabsByIdRef.current.get(tabId);
      if (currentTab) {
        void applyPassGuardToTab(currentTab);
      }
    },
    [applyPassGuardToTab, setupWebviewListeners],
  );

  useEffect(() => {
    return () => {
      webviewListenersRef.current.forEach(cleanup => cleanup());
      webviewListenersRef.current.clear();
      webviewsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!window.sylph?.onAppAction) return;

    const unsubscribe = window.sylph.onAppAction(({ action }) => {
      switch (action) {
        case 'new-tab': {
          createTab();
          break;
        }
        case 'close-tab': {
          const current = activeTabIdRef.current;
          if (current) {
            closeTab(current);
          }
          break;
        }
        case 'focus-address-bar': {
          addressInputRef.current?.focus();
          break;
        }
        case 'reload': {
          activeWebviewRef.current?.reload();
          break;
        }
        case 'go-back': {
          activeWebviewRef.current?.goBack();
          break;
        }
        case 'go-forward': {
          activeWebviewRef.current?.goForward();
          break;
        }
        case 'reopen-closed-tab': {
          reopenClosedTab();
          break;
        }
        case 'select-next-tab': {
          selectAdjacentTab('next');
          break;
        }
        case 'select-previous-tab': {
          selectAdjacentTab('previous');
          break;
        }
        default:
          break;
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [closeTab, createTab, reopenClosedTab, selectAdjacentTab]);

  useEffect(() => {
    if (!window.sylph?.onTabAction) return;

    const unsubscribe = window.sylph.onTabAction(({ action, tabId }) => {
      switch (action) {
        case 'pin':
          toggleTabPin(tabId, true);
          break;
        case 'unpin':
          toggleTabPin(tabId, false);
          break;
        case 'duplicate':
          duplicateTab(tabId);
          break;
        case 'close':
          closeTab(tabId);
          break;
        case 'close-others':
          closeOtherTabs(tabId);
          break;
        case 'close-right':
          closeTabsToRight(tabId);
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [closeOtherTabs, closeTab, closeTabsToRight, duplicateTab, toggleTabPin]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
        event.preventDefault();
        selectAdjacentTab(event.shiftKey ? 'previous' : 'next');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        reopenClosedTab();
      }
    };

    window.addEventListener('keydown', handleKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
    };
  }, [reopenClosedTab, selectAdjacentTab]);


  const handleFaviconError = useCallback(
    (tabId: string) => {
      updateTabById(tabId, tab => ({
        ...tab,
        favicon: '',
      }));
    },
    [updateTabById],
  );

  const updateAutomationForTab = useCallback(
    (
      tabId: string | null,
      transformer: (automation: Tab['automation'] | undefined) => Tab['automation'] | undefined,
    ) => {
      if (!tabId) return;
      updateTabById(tabId, tab => {
        const draft = cloneAutomationState(tab.automation);
        const next = transformer(draft);
        if (!next) {
          if (!tab.automation) return tab;
          return {
            ...tab,
            automation: undefined,
          };
        }
        return {
          ...tab,
          automation: next,
        };
      });
    },
    [updateTabById],
  );

  const mutateAutomationRun = useCallback(
    (tabId: string | null, runId: string, mutator: (run: AetherAutomationRun) => void) => {
      updateAutomationForTab(tabId, automation => {
        if (!automation) return automation;
        const index = automation.runs.findIndex(run => run.id === runId);
        if (index === -1) return automation;
        const runDraft = cloneAutomationRun(automation.runs[index]);
        mutator(runDraft);
        const runs = [...automation.runs];
        runs[index] = runDraft;
        const next: Tab['automation'] = {
          ...automation,
          runs,
        };
        if (isTerminalStatus(runDraft.status)) {
          if (next.activeRunId === runId) {
            next.activeRunId = undefined;
          }
        } else {
          next.activeRunId = runId;
        }
        return next;
      });
    },
    [updateAutomationForTab],
  );

  const handleSendAiPrompt = useCallback(
    async (startAutomation = false) => {
      if (isAiSending) return;

      const prompt = composerValue.trim();
      if (!prompt) return;

      const tabId = activeTabIdRef.current;
      if (!tabId) return;

      const now = Date.now();
      const userMessageId = uuidv4();
      const assistantMessageId = uuidv4();
      const sourceTab = tabs.find(tab => tab.id === tabId);

      setComposerValue('');
      setIsAiSending(true);

      let selectionText = '';
      const webview = webviewsRef.current.get(tabId);
      if (webview) {
        try {
          const result = await webview.executeJavaScript('window.getSelection().toString()', true);
          if (typeof result === 'string') {
            selectionText = result.trim();
          }
        } catch (error) {
          console.warn('Failed to read selection from webview', error);
        }
      }

      const attachedSelection = selectionText;
      assistantMessageMetaRef.current.set(assistantMessageId, {
        prompt,
        selection: attachedSelection || undefined,
      });

      const runModeForAutomation = composerModeToRunMode(composerMode);

      updateTabById(tabId, tab => {
        const context = cloneAiContext(tab.aiContext) ?? {
          messages: [],
          lastUsedAt: now,
        };
        const nextMessages: TabAIMessage[] = [
          ...context.messages,
          {
            id: userMessageId,
            role: 'user',
            content: prompt,
            createdAt: now,
            status: 'completed' as const,
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: now,
            status: 'pending' as const,
            linkedUserMessageId: userMessageId,
          },
        ];
        return {
          ...tab,
          aiContext: {
            selectedText: attachedSelection || context.selectedText,
            lastUsedAt: now,
            messages: nextMessages,
          },
        };
      });

      try {
        const promptResult = await window.sylph?.ai?.sendPrompt?.({
          prompt,
          tabId,
          tabContext: {
            url: sourceTab?.url,
            title: sourceTab?.title,
            selectedText: attachedSelection || undefined,
          },
        });

        if (!promptResult?.success) {
          throw new Error(promptResult?.error ?? 'Failed to fetch response.');
        }

        const assistantContent = promptResult.output ?? '';

        updateTabById(tabId, tab => {
          if (!tab.aiContext) return tab;
          const nextMessages = tab.aiContext.messages.map(message => {
            if (message.id !== assistantMessageId) return message;
            return {
              ...message,
              content: assistantContent,
              status: 'completed' as const,
            };
          });
          return {
            ...tab,
            aiContext: {
              ...tab.aiContext,
              messages: nextMessages,
              lastUsedAt: Date.now(),
            },
          };
        });

        if (startAutomation) {
          setAutomationBootstrapMessageId(assistantMessageId);
          try {
            await startAutomationForMessage({
              tabId,
              assistantMessageId,
              prompt,
              selection: attachedSelection || undefined,
              mode: runModeForAutomation,
            });
          } finally {
            setAutomationBootstrapMessageId(null);
          }
        }
      } catch (error) {
        const fallback = error instanceof Error ? error.message : 'Failed to reach Sylph Aether.';
        updateTabById(tabId, tab => {
          if (!tab.aiContext) return tab;
          const nextMessages = tab.aiContext.messages.map(message => {
            if (message.id !== assistantMessageId) return message;
            return {
              ...message,
              content: fallback,
              status: 'error' as const,
            };
          });
          return {
            ...tab,
            aiContext: {
              ...tab.aiContext,
              selectedText: attachedSelection || tab.aiContext.selectedText,
              lastUsedAt: Date.now(),
              messages: nextMessages,
            },
          };
        });
      } finally {
        setIsAiSending(false);
      }
    },
    [
      composerValue,
      composerMode,
      isAiSending,
      startAutomationForMessage,
      tabs,
      updateTabById,
    ],
  );

  const handleComposerSubmit = useCallback(() => {
    if (composerMode === 'ask') {
      void handleSendAiPrompt(false);
      return;
    }

    if (isAgentComposerMode(composerMode)) {
      if (isAutomationActive) return;
      void handleSendAiPrompt(true);
      return;
    }

    // auto mode
    const trimmed = composerValue.trim();
    if (!trimmed) return;
    const shouldRun = isAutomationActive ? false : shouldAutoRunAutomation(trimmed);
    void handleSendAiPrompt(shouldRun);
  }, [composerMode, composerValue, handleSendAiPrompt, isAutomationActive]);

  const handleAutomationForMessage = useCallback(
    async (message: TabAIMessage) => {
      const tabId = activeTab?.id;
      if (!tabId) return;
      if (message.runId) return;
      if (isAutomationActive) return;

      const meta = assistantMessageMetaRef.current.get(message.id);
      const linkedUserMessage = message.linkedUserMessageId
        ? activeAiMessages.find(item => item.id === message.linkedUserMessageId)
        : undefined;
      const prompt = meta?.prompt ?? linkedUserMessage?.content ?? '';
      const selection = meta?.selection ?? activeTab?.aiContext?.selectedText;
      if (!prompt) return;

      assistantMessageMetaRef.current.set(message.id, {
        prompt,
        selection: selection || undefined,
      });

      const desiredMode = isAgentComposerMode(composerMode) ? composerMode : 'agent-thinking';
      const runMode = composerModeToRunMode(desiredMode as ComposerMode);
      setAutomationBootstrapMessageId(message.id);
      try {
      await startAutomationForMessage({
        tabId,
        assistantMessageId: message.id,
        prompt,
        selection: selection || undefined,
        mode: runMode,
      });
      } catch (error) {
        const fallback = error instanceof Error ? error.message : 'Failed to start automation.';
        updateTabById(tabId, tab => {
          if (!tab.aiContext) return tab;
          const nextMessages = tab.aiContext.messages.map(item =>
            item.id === message.id
              ? {
                  ...item,
                  status: 'completed' as const,
                  content: `${item.content}\n\n⚠️ ${fallback}`,
                }
              : item,
          );
          return {
            ...tab,
            aiContext: {
              ...tab.aiContext,
              messages: nextMessages,
              lastUsedAt: Date.now(),
            },
          };
        });
      } finally {
        setAutomationBootstrapMessageId(null);
      }
    },
    [
      activeAiMessages,
      activeTab?.aiContext?.selectedText,
      activeTab?.id,
      composerMode,
      isAutomationActive,
      startAutomationForMessage,
      updateTabById,
    ],
  );

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleComposerSubmit();
    }
  };

  const handleCollapseAiPanel = useCallback(() => {
    setIsAiCollapsed(true);
  }, []);

  const handleExpandAiPanel = useCallback(() => {
    setIsAiCollapsed(false);
  }, []);

  const handleResizerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isAiCollapsed) return;
      event.preventDefault();
      resizerActiveRef.current = true;
      resizerStartXRef.current = event.clientX;
      resizerStartWidthRef.current = aiPanelWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!resizerActiveRef.current) return;
        const delta = resizerStartXRef.current - moveEvent.clientX;
        const nextWidth = clampAiPanelWidth(resizerStartWidthRef.current + delta);
        setAiPanelWidth(nextWidth);
      };

      const handlePointerUp = () => {
        resizerActiveRef.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp as EventListener);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp as EventListener, { once: true });
    },
    [aiPanelWidth, isAiCollapsed],
  );

  const handleApproveAutomationStep = useCallback(() => {
    if (!activeAutomation || !pendingApprovalStep) return;
    window.sylph?.ai?.automation?.submitApproval?.({
      runId: activeAutomation.id,
      stepId: pendingApprovalStep.id,
      approved: true,
    });
  }, [activeAutomation, pendingApprovalStep]);

  const handleRejectAutomationStep = useCallback(() => {
    if (!activeAutomation || !pendingApprovalStep) return;
    window.sylph?.ai?.automation?.submitApproval?.({
      runId: activeAutomation.id,
      stepId: pendingApprovalStep.id,
      approved: false,
      reason: 'User denied request',
    });
  }, [activeAutomation, pendingApprovalStep]);

  const handleCancelAutomation = useCallback(() => {
    if (!activeAutomation) return;
    window.sylph?.ai?.automation?.cancelRun?.({
      runId: activeAutomation.id,
      reason: 'Stopped by user',
    });
  }, [activeAutomation]);

  const executeAutomationCall = useCallback(
    async (runId: string, tabId: string | null, stepId: string, command: AutomationCommand) => {
      const reportResult = window.sylph?.ai?.automation?.reportStepResult;
      if (!reportResult) return;

      if (!tabId) {
        await reportResult({
          runId,
          stepId,
          success: false,
          output: '',
          error: 'No tab associated with automation run.',
        });
        return;
      }

      const targetWebview = webviewsRef.current.get(tabId);
      if (!targetWebview) {
        await reportResult({
          runId,
          stepId,
          success: false,
          output: '',
          error: 'Unable to locate target tab for automation.',
        });
        return;
      }

      try {
        const serializedCommand = JSON.stringify(command);
        const buildElementActionScript = (actionBody: string) => `
(() => {
  const command = ${serializedCommand};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const uniq = list => Array.from(new Set(list));
  const textMatches = (element, text, strategy = 'equals') => {
    if (!text || typeof text !== 'string') return false;
    const content = (element.innerText || element.textContent || '').trim();
    if (strategy === 'contains') {
      return content.toLowerCase().includes(text.toLowerCase());
    }
    return content === text;
  };
  const attributesMatch = (element, attributes) => {
    if (!attributes) return true;
    return Object.entries(attributes).every(([key, value]) => {
      if (typeof value !== 'string') return false;
      const attrValue =
        element.getAttribute(key) ||
        (key in element ? String(element[key]) : null);
      return attrValue === value;
    });
  };
  const collectCandidates = () => {
    const nodes = [];
    const selectors = [];
    if (typeof command.selector === 'string') selectors.push(command.selector);
    if (Array.isArray(command.selectors)) {
      command.selectors.forEach(item => {
        if (typeof item === 'string') selectors.push(item);
      });
    }
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(node => nodes.push(node));
      } catch {
        // ignore invalid selectors
      }
    });
    const fallback = command.fallback || {};
    if (fallback.text || command.text) {
      const targetText = fallback.text ?? command.text;
      const strategy = fallback.strategy ?? 'equals';
      document.querySelectorAll('*').forEach(node => {
        if (textMatches(node, targetText, strategy)) {
          nodes.push(node);
        }
      });
    }
    if (fallback.attributes) {
      document.querySelectorAll('*').forEach(node => {
        if (attributesMatch(node, fallback.attributes)) {
          nodes.push(node);
        }
      });
    }
    return uniq(nodes).filter(Boolean);
  };
  const pickCandidate = nodes => {
    if (!nodes.length) return null;
    if (typeof command.index === 'number' && command.index >= 0 && command.index < nodes.length) {
      return nodes[command.index];
    }
    if (typeof command.fallback?.index === 'number') {
      const idx = command.fallback.index;
      if (idx >= 0 && idx < nodes.length) return nodes[idx];
    }
    return nodes[0];
  };
  const waitForCandidate = async timeout => {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      const nodes = collectCandidates();
      const picked = pickCandidate(nodes);
      if (picked) return picked;
      await sleep(100);
    }
    return null;
  };
  const waitForSelector = async selector => {
    if (!selector) return;
    const timeout = command.wait?.timeout ?? 5000;
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try {
        if (document.querySelector(selector)) return;
      } catch {
        // ignore selector errors while waiting
      }
      await sleep(100);
    }
  };
  return (async () => {
    if (command.wait?.selector) {
      await waitForSelector(command.wait.selector);
    }
    const timeout = command.wait?.timeout ?? 4000;
    const element = await waitForCandidate(timeout);
    if (!element) {
      return { success: false, error: 'Element not found' };
    }
    ${actionBody}
  })();
})();
`;

        const executeScript = async (script: string) => {
          const result = await targetWebview.executeJavaScript(script, true);
          return result as { success?: boolean; error?: string; output?: string; data?: unknown };
        };

        let screenshotDataUrl: string | undefined;
        let result:
          | { success?: boolean; error?: string; output?: string; data?: unknown }
          | undefined;
        const lowerAction = (command.action || '').toLowerCase();

        const runMode = automationRunModeRef.current.get(runId) ?? 'auto';

        if (lowerAction === 'click') {
          result = await executeScript(
            buildElementActionScript(`
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      element.focus?.();
      element.click();
      return { success: true, output: command.note || 'Clicked element.' };
    `),
          );
        } else if (lowerAction === 'type') {
          result = await executeScript(
            buildElementActionScript(`
      const value = typeof command.value === 'string'
        ? command.value
        : typeof command.text === 'string'
        ? command.text
        : '';
      const clearFirst = command.clear !== false;
      if ('value' in element) {
        element.focus?.();
        if (clearFirst) {
          element.value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, output: 'Typed text.' };
      }
      if (element.isContentEditable) {
        element.focus?.();
        element.textContent = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, output: 'Typed text.' };
      }
      return { success: false, error: 'Target element is not input-like.' };
    `),
          );
        } else if (lowerAction === 'set_checked') {
          result = await executeScript(
            buildElementActionScript(`
      const desired = command.checked ?? command.value ?? true;
      const resolved = typeof desired === 'string'
        ? !['false', '0', 'no'].includes(desired.toLowerCase())
        : Boolean(desired);
      if ('checked' in element) {
        element.focus?.();
        element.checked = resolved;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, output: 'Updated checkbox state.' };
      }
      return { success: false, error: 'Target element is not checkable.' };
    `),
          );
        } else if (lowerAction === 'scroll') {
          const amount =
            typeof command.amount === 'number'
              ? command.amount
              : command.direction === 'up'
              ? -600
              : command.direction === 'left'
              ? -600
              : command.direction === 'right'
              ? 600
              : 600;
          if (command.selector || (Array.isArray(command.selectors) && command.selectors.length > 0)) {
            result = await executeScript(
              buildElementActionScript(`
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        return { success: true, output: 'Scrolled element into view.' };
      `),
            );
          } else {
            result = await executeScript(`
(() => {
  const command = ${serializedCommand};
  const amount = ${Number.isFinite(Number(amount)) ? Number(amount) : 600};
  window.scrollBy({ top: amount, behavior: 'smooth' });
  return { success: true, output: 'Scrolled page.' };
})();
`);
          }
        } else if (lowerAction === 'extract_text') {
          result = await executeScript(
            buildElementActionScript(`
      const text = (element.innerText || element.textContent || '').trim();
      return { success: true, output: text };
    `),
          );
        } else if (lowerAction === 'inspect') {
          result = await executeScript(
            buildElementActionScript(`
      const rect = element.getBoundingClientRect();
      const metadata = {
        tag: element.tagName,
        id: element.id || null,
        classes: element.className || null,
        text: (element.innerText || element.textContent || '').trim().slice(0, 400),
        value: 'value' in element ? element.value : null,
        ariaLabel: element.getAttribute('aria-label'),
        role: element.getAttribute('role'),
        rect: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        },
      };
      return { success: true, output: JSON.stringify(metadata) };
    `),
          );
        } else if (lowerAction === 'wait') {
          result = await executeScript(`
(() => {
  const command = ${serializedCommand};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  return (async () => {
    const selector = command.selector || command.wait?.selector;
    const timeout = command.wait?.timeout ?? command.timeout ?? 3000;
    if (!selector) {
      await sleep(timeout);
      return { success: true, output: 'Waited ' + timeout + 'ms.' };
    }
    const start = performance.now();
    while (performance.now() - start < timeout) {
      try {
        if (document.querySelector(selector)) {
          return { success: true, output: 'Selector became available.' };
        }
      } catch {
        // ignore
      }
      await sleep(100);
    }
    return { success: false, error: 'Timed out waiting for selector.' };
  })();
})();
`);
        } else if (lowerAction === 'screenshot') {
          const hasSelector = Boolean(
            command.selector || (Array.isArray(command.selectors) && command.selectors.length > 0),
          );
          if (hasSelector || command.text || command.fallback) {
            const scriptResult = await executeScript(
              buildElementActionScript(`
      const rect = element.getBoundingClientRect();
      return {
        success: true,
        data: {
          rect: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          }
        },
        output: 'Captured screenshot region.'
      };
    `),
            );
            result = scriptResult;
            const rectData =
              scriptResult?.data && typeof scriptResult.data === 'object'
                ? (scriptResult.data as { rect?: { x: number; y: number; width: number; height: number } }).rect
                : undefined;
            const image = await targetWebview.capturePage(
              rectData
                ? {
                    x: Math.max(0, Math.floor(rectData.x)),
                    y: Math.max(0, Math.floor(rectData.y)),
                    width: Math.max(1, Math.floor(rectData.width)),
                    height: Math.max(1, Math.floor(rectData.height)),
                  }
                : undefined,
            );
            screenshotDataUrl = image.toDataURL();
          } else {
            result = { success: true, output: 'Captured page screenshot.' };
            const image = await targetWebview.capturePage();
            screenshotDataUrl = image.toDataURL();
          }
        } else if (lowerAction === 'navigate') {
          const rawUrl = typeof command.url === 'string' && command.url.trim().length > 0
            ? command.url.trim()
            : typeof command.text === 'string' && command.text.trim().length > 0
            ? command.text.trim()
            : undefined;
          if (!rawUrl) {
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: 'Navigate action requires a URL.',
            });
            return;
          }
          let normalizedUrl = rawUrl;
          if (!/^[a-zA-Z][\w+.-]*:/.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
          }
          try {
            const verified = new URL(normalizedUrl);
            normalizedUrl = verified.toString();
          } catch {
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: 'Invalid URL provided for navigate action.',
            });
            return;
          }

          await targetWebview.loadURL(normalizedUrl);
          result = { success: true, output: `Navigated to ${normalizedUrl}` };
        } else if (lowerAction === 'web_search') {
          const query = typeof command.query === 'string' && command.query.trim().length > 0
            ? command.query.trim()
            : typeof command.text === 'string' && command.text.trim().length > 0
            ? command.text.trim()
            : typeof command.value === 'string' && command.value.trim().length > 0
            ? command.value.trim()
            : undefined;

          if (!query) {
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: 'web_search requires a non-empty query.',
            });
            return;
          }

          const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`; 
          let payload: unknown = null;
          try {
            const response = await fetch(searchUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
              },
            });
            if (!response.ok) {
              throw new Error(`Search request failed with status ${response.status}`);
            }
            payload = await response.json();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: `web_search error: ${message}`,
            });
            return;
          }

          const results: Array<{ text: string; url?: string }> = [];
          const pushTopic = (topic: unknown) => {
            if (!topic || typeof topic !== 'object') return;
            const maybeText = (topic as { Text?: unknown }).Text;
            const maybeUrl = (topic as { FirstURL?: unknown }).FirstURL;
            const text = typeof maybeText === 'string' ? maybeText.trim() : '';
            const url = typeof maybeUrl === 'string' ? maybeUrl.trim() : undefined;
            if (!text) return;
            results.push({ text, url });
          };

          if (payload && typeof payload === 'object') {
            const related = (payload as { RelatedTopics?: unknown }).RelatedTopics;
            if (Array.isArray(related)) {
              related.forEach(item => {
                if (item && typeof item === 'object') {
                  const maybeTopics = (item as { Topics?: unknown }).Topics;
                  if (Array.isArray(maybeTopics)) {
                    maybeTopics.forEach(pushTopic);
                    return;
                  }
                }
                pushTopic(item);
              });
            }
          }

          const topResults = results.slice(0, 5);
          const outputLines = topResults.length
            ? topResults.map((entry, index) => `${index + 1}. ${entry.text}${entry.url ? ` — ${entry.url}` : ''}`)
            : ['No results found.'];
          const outputText = `DuckDuckGo search for "${query}":\n${outputLines.join('\n')}`;
          result = {
            success: true,
            output: outputText,
          };
        } else if (lowerAction === 'scan_interactives') {
          const scanScript = `(() => {
  try {
  const MAX_ITEMS = 80;
  const attr = 'data-sylph-candidate';
  Array.from(document.querySelectorAll('[' + attr + ']')).forEach(el => {
    if (el instanceof HTMLElement) el.removeAttribute(attr);
  });

  const isVisible = element => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const opacity = Number.parseFloat(style.opacity);
    if (!Number.isFinite(opacity) ? false : opacity === 0) return false;
    let current = element;
    while (current) {
      if (current instanceof HTMLElement && current.hidden) return false;
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
    if (rect.width < 4 || rect.height < 4) return false;
    return rect.width * rect.height > 16;
  };

  const selectorList = [
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'details',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="option"]'
  ];
  const raw = Array.from(document.querySelectorAll(selectorList.join(',')));

  if (!window._sylphSnapshot) {
    window._sylphSnapshot = new WeakMap();
  }
  const snapshot = window._sylphSnapshot;

  const describe = element => {
    if (snapshot.has(element)) return snapshot.get(element);
    const textCandidates = [
      element.innerText,
      element.value,
      element.getAttribute('aria-label'),
      element.getAttribute('name'),
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.getAttribute('alt')
    ];
    const label = textCandidates
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .find(value => value.length > 0) || element.tagName.toLowerCase();
    const rect = element.getBoundingClientRect();
    const record = {
      label: label.slice(0, 120),
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    };
    snapshot.set(element, record);
    return record;
  };

  const filtered = [];
  for (const node of raw) {
    if (!(node instanceof HTMLElement)) continue;
    if (filtered.length >= MAX_ITEMS) break;
    if (!node.isConnected) continue;
    if (!isVisible(node)) continue;
    const record = describe(node);
    if (!record) continue;
    const id = 'sylph-' + (filtered.length + 1);
    try {
      node.dataset.sylphCandidate = id;
    } catch {
      continue;
    }
    filtered.push({
      index: filtered.length + 1,
      id,
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') || null,
      type: node.getAttribute('type') || null,
      label: record.label,
      selector: '[' + attr + '="' + id + '"]',
      rect: record.rect,
    });
  }

  if (!filtered.length) {
    return { success: true, output: 'No interactive elements found.' };
  }
  const lines = filtered.map(item => item.index + '. ' + item.tag + ' ' + item.label + ' -> ' + item.selector);
  return { success: true, output: lines.join('\n'), data: filtered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Sylph scan_interactives] script error:', message);
    return { success: false, error: message };
  }
})()`;

          result = await targetWebview.executeJavaScript(scanScript, true);
          if (!result?.success) {
            console.warn('[Sylph scan_interactives] command returned failure', result);
          }
          if (!result?.success) {
            console.warn('[Sylph scan_interactives] command returned failure', result);
          }
        } else if (lowerAction === 'grid_overlay') {
          const options = (command.options ?? {}) as Record<string, unknown>;
          const remove = Boolean(options.remove);
          const rowsRaw = options.rows ?? options.rowCount ?? options.height;
          const colsRaw = options.cols ?? options.colCount ?? options.width;
          const parsedRows = typeof rowsRaw === 'number' ? rowsRaw : parseInt(String(rowsRaw ?? '40'), 10);
          const parsedCols = typeof colsRaw === 'number' ? colsRaw : parseInt(String(colsRaw ?? '35'), 10);
          const rows = Number.isFinite(parsedRows) ? Math.min(Math.max(parsedRows, 1), 60) : 40;
          const cols = Number.isFinite(parsedCols) ? Math.min(Math.max(parsedCols, 1), 60) : 35;

          const overlayScript = remove
            ? `(() => {
  const existing = document.getElementById('__sylph_grid_overlay');
  if (existing) existing.remove();
  if (window.__sylphGrid) delete window.__sylphGrid;
  return { success: true, output: 'Grid overlay removed.' };
})();`
            : `(() => {
  const rows = ${rows};
  const cols = ${cols};
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1 || rows > 60 || cols > 60) {
    return { success: false, error: 'Invalid grid dimensions.' };
  }
  const existing = document.getElementById('__sylph_grid_overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = '__sylph_grid_overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483647';
  overlay.style.display = 'grid';
  overlay.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
  overlay.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  overlay.style.background = 'rgba(0, 0, 0, 0.28)';
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.style.border = '1px solid rgba(255, 255, 255, 0.22)';
      cell.style.boxSizing = 'border-box';
      cell.style.display = 'flex';
      cell.style.alignItems = 'flex-start';
      cell.style.justifyContent = 'flex-end';
      cell.style.fontFamily = 'monospace';
      cell.style.fontSize = '11px';
      cell.style.color = 'rgba(255, 255, 255, 0.85)';
      cell.style.padding = '2px 4px';
      cell.style.background = 'rgba(0, 0, 0, 0.15)';
      const label = String.fromCharCode(65 + c) + (r + 1);
      cell.textContent = label;
      overlay.appendChild(cell);
      cells.push({ label, row: r + 1, col: c + 1 });
    }
  }
  document.body.appendChild(overlay);
  const metrics = Array.from(overlay.children).map((el, index) => {
    const rect = el.getBoundingClientRect();
    const cell = cells[index];
    return {
      label: cell.label,
      row: cell.row,
      col: cell.col,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      center: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    };
  });
  window.__sylphGrid = { rows, cols, metrics };
  return { success: true, output: 'Grid overlay displayed.', data: metrics };
})();`;

          result = await targetWebview.executeJavaScript(overlayScript, true);
        } else if (lowerAction === 'grid_click') {
      const runMode = automationRunModeRef.current.get(runId) ?? 'auto';
      if (!['auto', 'agent_thinking', 'agent_fast'].includes(runMode)) {
        await reportResult({
          runId,
          stepId,
          success: false,
          output: '',
              error: 'Run mode does not support clicking grid cells.',
            });
            return;
          }

          const cellRefRaw = (command.cell ?? command.value ?? command.text ?? '').toString().trim();
          const rowValue = command.options?.row ?? command.options?.r ?? command.row ?? command.r;
          const colValue = command.options?.col ?? command.options?.column ?? command.col ?? command.c;

          const gridClickScript = `(() => {
  const grid = window.__sylphGrid;
  if (!grid || !Array.isArray(grid.metrics)) {
    return { success: false, error: 'Grid overlay not available. Create one first.' };
  }
  const raw = ${JSON.stringify(cellRefRaw)}.trim();
  let targetMetric = null;
  const normalize = value => {
    if (!value) return null;
    const str = String(value).trim().toUpperCase();
    if (!/^[A-Z][0-9]{1,2}$/.test(str)) return null;
    const col = str.charCodeAt(0) - 64;
    const row = parseInt(str.slice(1), 10);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col, label: str[0] + row };
  };
  let ref = normalize(raw);
  if (!ref) {
    const rowOverride = ${rowValue !== undefined ? JSON.stringify(rowValue) : 'null'};
    const colOverride = ${colValue !== undefined ? JSON.stringify(colValue) : 'null'};
    if (rowOverride !== null && colOverride !== null) {
      const row = parseInt(String(rowOverride), 10);
      const col = parseInt(String(colOverride), 10);
      if (Number.isFinite(row) && Number.isFinite(col)) {
        ref = { row, col, label: String.fromCharCode(64 + col) + row };
      }
    }
  }
  if (!ref) {
    return { success: false, error: 'Provide a valid grid cell reference like B3.' };
  }
  targetMetric = grid.metrics.find(metric => metric.row === ref.row && metric.col === ref.col);
  if (!targetMetric) {
    return { success: false, error: 'Grid cell ' + ref.label + ' not found.' };
  }
  const { x, y } = targetMetric.center;
  const target = document.elementFromPoint(x, y);
  if (!target) {
    return { success: false, error: 'No element found under grid cell ' + ref.label + '.' };
  }
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, ...eventInit }));
    target.dispatchEvent(new MouseEvent('mousedown', eventInit));
    target.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 1, ...eventInit }));
    target.dispatchEvent(new MouseEvent('mouseup', eventInit));
  } catch (error) {
    // ignore pointer errors, fallback to click
  }
  if (typeof target.click === 'function') {
    target.click();
  }
  return { success: true, output: 'Clicked grid cell ' + ref.label };
})();`;

          result = await targetWebview.executeJavaScript(gridClickScript, true);
        } else if (lowerAction === 'run_script') {
          if (!isAgentRunMode(runMode)) {
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: 'Custom JavaScript execution is only allowed in Agent mode.',
            });
            return;
          }
          if (typeof command.code !== 'string' || !command.code.trim()) {
            await reportResult({
              runId,
              stepId,
              success: false,
              output: '',
              error: 'No JavaScript code provided for run_script action.',
            });
            return;
          }

          const runScript = `
(() => {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AsyncFunction(${JSON.stringify(command.code)});
  return Promise.resolve()
    .then(fn)
    .then(result => ({ success: true, output: result }))
    .catch(error => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
})();
`;

          const scriptResult = await targetWebview.executeJavaScript(runScript, true);
          const success = Boolean(scriptResult?.success);
          const outputValue = scriptResult?.output;
          let outputString: string;
          if (outputValue === undefined || outputValue === null) {
            outputString = 'Custom script executed.';
          } else if (typeof outputValue === 'string') {
            outputString = outputValue;
          } else {
            try {
              outputString = JSON.stringify(outputValue);
            } catch {
              outputString = String(outputValue);
            }
          }
          result = {
            success,
            output: outputString,
            error: success ? undefined : scriptResult?.error || 'Custom script failed.',
          };
        } else {
          result = await executeScript(`
(() => ({ success: false, error: 'Unsupported action: ${command.action}' }))();
`);
        }

        const success = result?.success === true;
        const output =
          (typeof result?.output === 'string' && result.output) ||
          (result?.data ? JSON.stringify(result.data) : '') ||
          '';

        await reportResult({
          runId,
          stepId,
          success,
          output: success ? output || 'Completed automation step.' : output,
          screenshotDataUrl,
          error: success ? undefined : result?.error || 'Automation step failed.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await reportResult({
          runId,
          stepId,
          success: false,
          output: '',
          error: message,
        });
      }
    },
    [webviewsRef],
  );

  const handleAutomationEvent = useCallback(
    (event: AetherAutomationEvent) => {
      switch (event.type) {
        case 'chat-delta': {
          const messageId = runAssistantMessageMapRef.current.get(event.runId);
          if (!messageId) {
            const existing = pendingChatBuffersRef.current.get(event.runId) ?? '';
            pendingChatBuffersRef.current.set(event.runId, existing + event.delta);
            break;
          }
          updateAssistantMessageForRun(event.tabId, event.runId, message => ({
            ...message,
            content: `${message.content ?? ''}${event.delta}`,
            status: 'pending',
          }));
          break;
        }
        case 'chat-complete': {
          const messageId = runAssistantMessageMapRef.current.get(event.runId);
          if (!messageId) {
            pendingChatFinalRef.current.set(event.runId, {
              content: event.content,
              status: 'completed',
            });
            pendingChatBuffersRef.current.delete(event.runId);
            break;
          }
          const pendingBuffer = pendingChatBuffersRef.current.get(event.runId) ?? '';
          pendingChatBuffersRef.current.delete(event.runId);
          updateAssistantMessageForRun(event.tabId, event.runId, message => ({
            ...message,
            content: event.content || `${message.content ?? ''}${pendingBuffer}`,
            status: 'completed',
          }));
          runAssistantMessageMapRef.current.delete(event.runId);
          pendingChatFinalRef.current.delete(event.runId);
          break;
        }
        case 'chat-error': {
          const messageId = runAssistantMessageMapRef.current.get(event.runId);
          if (!messageId) {
            pendingChatFinalRef.current.set(event.runId, {
              content: event.error,
              status: 'error',
            });
            pendingChatBuffersRef.current.delete(event.runId);
            break;
          }
          updateAssistantMessageForRun(event.tabId, event.runId, message => ({
            ...message,
            content: event.error,
            status: 'error',
          }));
          runAssistantMessageMapRef.current.delete(event.runId);
          pendingChatFinalRef.current.delete(event.runId);
          break;
        }
        case 'step-execute': {
          void (async () => {
            await executeAutomationCall(event.runId, event.tabId, event.step.id, event.command);
          })();
          break;
        }
        default:
          break;
      }

      switch (event.type) {
        case 'run-created': {
          const run = cloneAutomationRun(event.run);
          const normalizedMode = isAgentRunMode(run.mode ?? undefined) ? (run.mode as 'agent_thinking' | 'agent_fast') : 'auto';
          automationRunModeRef.current.set(run.id, normalizedMode);
          updateAutomationForTab(run.tabId, automation => {
            const baseRuns = automation ? [...automation.runs] : [];
            const existingIndex = baseRuns.findIndex(existing => existing.id === run.id);
            if (existingIndex >= 0) {
              baseRuns[existingIndex] = run;
            } else {
              baseRuns.push(run);
            }
            const activeRunId = isTerminalStatus(run.status)
              ? automation?.activeRunId === run.id
                ? undefined
                : automation?.activeRunId
              : run.id;
            return {
              activeRunId,
              runs: baseRuns,
            };
          });
          break;
        }
        case 'run-updated': {
          const run = cloneAutomationRun(event.run);
          const normalizedMode = isAgentRunMode(run.mode ?? undefined) ? (run.mode as 'agent_thinking' | 'agent_fast') : 'auto';
          automationRunModeRef.current.set(run.id, normalizedMode);
          updateAutomationForTab(run.tabId, automation => {
            const baseRuns = automation ? [...automation.runs] : [];
            const existingIndex = baseRuns.findIndex(existing => existing.id === run.id);
            if (existingIndex >= 0) {
              baseRuns[existingIndex] = run;
            } else {
              baseRuns.push(run);
            }
            const activeRunId = isTerminalStatus(run.status)
              ? automation?.activeRunId === run.id
                ? undefined
                : automation?.activeRunId
              : run.id;
            return {
              activeRunId,
              runs: baseRuns,
            };
          });
          break;
        }
        case 'step-request':
        case 'step-updated': {
          mutateAutomationRun(event.tabId, event.runId, run => {
            const stepClone = { ...event.step };
            const stepIndex = run.steps.findIndex(step => step.id === stepClone.id);
            if (stepIndex >= 0) {
              run.steps[stepIndex] = stepClone;
            } else {
              run.steps = [...run.steps, stepClone];
            }
            run.updatedAt = Date.now();
          });
          break;
        }
        case 'run-completed': {
          mutateAutomationRun(event.tabId, event.runId, run => {
            run.status = event.status;
            run.error = event.error;
            run.updatedAt = Date.now();
          });
          automationRunModeRef.current.delete(event.runId);
          if (event.status !== 'completed') {
            updateAssistantMessageForRun(event.tabId, event.runId, message => ({
              ...message,
              status: 'error',
              content: message.content || event.error || 'Automation run cancelled.',
            }));
          }
          runAssistantMessageMapRef.current.delete(event.runId);
          pendingChatBuffersRef.current.delete(event.runId);
          pendingChatFinalRef.current.delete(event.runId);
          break;
        }
        default:
          break;
      }
    },
    [executeAutomationCall, mutateAutomationRun, updateAssistantMessageForRun, updateAutomationForTab],
  );

  useEffect(() => {
    const unsubscribe = window.sylph?.ai?.automation?.onEvent?.(handleAutomationEvent);
    return () => {
      unsubscribe?.();
    };
  }, [handleAutomationEvent]);

  const handleOpenSettings = useCallback(() => {
    window.sylph?.openSettingsWindow?.();
  }, []);

  return (
    <div className="app-shell">
      <aside className={`sidebar${isSidebarCollapsed ? ' is-collapsed' : ''}`}>
        <div className="sidebar__header">
          <button
            className="sidebar__collapse-toggle"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            type="button"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? '›' : '‹'}
          </button>
          <div className="sidebar__brand">Sylph</div>
          <button
            className="sidebar__new-tab"
            onClick={() => createTab()}
            type="button"
          >
            + New tab
          </button>
        </div>

        <div className="sidebar__spaces">
          <div className="sidebar__section-label">Spaces</div>
          <div className="sidebar__space-list">
            {spaces.map(space => (
              <div key={space.id} className="sidebar__space-wrapper">
                <button
                  type="button"
                  className={`sidebar__space ${space.id === activeSpaceId ? 'is-active' : ''}`}
                  onClick={event => {
                    event.stopPropagation();
                    setSpaceContextMenuId(null);
                    activateSpace(space.id);
                  }}
                  onDoubleClick={event => {
                    event.stopPropagation();
                    renameSpace(space.id);
                  }}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSpaceContextMenuId(spaceContextMenuId === space.id ? null : space.id);
                  }}
                >
                  <span
                    className="sidebar__space-dot"
                    style={{ backgroundColor: space.color }}
                    aria-hidden="true"
                  />
                  <span className="sidebar__space-name">{space.name}</span>
                </button>
                {spaceContextMenuId === space.id && (
                  <div
                    className="sidebar__space-menu"
                    onClick={event => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="sidebar__space-menu-item"
                      onClick={event => {
                        event.stopPropagation();
                        renameSpace(space.id);
                        setSpaceContextMenuId(null);
                      }}
                    >
                      ✏️ Rename
                    </button>
                    <div className="sidebar__space-menu-section">
                      <div className="sidebar__space-menu-label">Change Color</div>
                      <div className="sidebar__space-menu-colors">
                        {SPACE_COLOR_PALETTE.map(color => (
                          <button
                            key={color}
                            type="button"
                            className="sidebar__space-menu-color"
                            style={{ backgroundColor: color }}
                            title={`Change to ${color}`}
                            aria-label={`Change color to ${color}`}
                            onClick={event => {
                              event.stopPropagation();
                              changeSpaceColor(space.id, color);
                              setSpaceContextMenuId(null);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    {space.id !== DEFAULT_SPACE_ID && spaces.length > 1 && (
                      <>
                        <div className="sidebar__space-menu-divider" />
                        <button
                          type="button"
                          className="sidebar__space-menu-item sidebar__space-menu-item--danger"
                          onClick={event => {
                            event.stopPropagation();
                            deleteSpace(space.id);
                            setSpaceContextMenuId(null);
                          }}
                        >
                          🗑️ Delete Space
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="sidebar__space-new"
            onClick={event => {
              event.stopPropagation();
              createSpace();
            }}
          >
            + Add space
          </button>
        </div>

        <div className="sidebar__section">
          <div className="sidebar__section-label">Tabs</div>
          <div className="sidebar__tab-list">
            {tabs.map((tab, tabIndex) => {
              const isSplitMember =
                activeSplit.isSplit &&
                (activeSplit.primaryTabId === tab.id || activeSplit.secondaryTabId === tab.id);
              const isSplitFocus =
                isSplitMember &&
                ((activeSplit.focus === 'primary' && activeSplit.primaryTabId === tab.id) ||
                  (activeSplit.focus === 'secondary' && activeSplit.secondaryTabId === tab.id));
              const isDragging = draggedTabId === tab.id;
              const isDragOver = dragOverTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  className={`sidebar__tab${tab.isActive ? ' is-active' : ''}${isSplitMember ? ' is-split' : ''}${isSplitFocus ? ' is-split-focus' : ''}${isDragging ? ' is-dragging' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveTab(tab.id);
                    }
                  }}
                  onContextMenu={event => {
                    event.preventDefault();
                    window.sylph?.requestTabContextMenu?.({
                      tabId: tab.id,
                      isPinned: tab.isPinned,
                      url: tab.url,
                      position: { x: event.pageX, y: event.pageY },
                    });
                  }}
                  onDragStart={event => {
                    setDraggedTabId(tab.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tab.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTabId(null);
                    setDragOverTabId(null);
                  }}
                  onDragOver={event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (draggedTabId && draggedTabId !== tab.id) {
                      setDragOverTabId(tab.id);
                    }
                  }}
                  onDragLeave={() => {
                    setDragOverTabId(null);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    const draggedId = event.dataTransfer.getData('text/plain');
                    if (draggedId && draggedId !== tab.id) {
                      const fromIndex = tabs.findIndex(t => t.id === draggedId);
                      const toIndex = tabIndex;
                      if (fromIndex !== -1 && toIndex !== -1) {
                        reorderTabsInSpace(activeSpaceId, fromIndex, toIndex);
                      }
                    }
                    setDraggedTabId(null);
                    setDragOverTabId(null);
                  }}
                >
                  <div className="sidebar__tab-indicator" />
                  <div className="sidebar__tab-content">
                    <div className="sidebar__tab-line">
                      <div className="sidebar__tab-favicon" aria-hidden="true">
                        {tab.favicon ? (
                          <img
                            src={tab.favicon}
                            alt=""
                            onError={() => handleFaviconError(tab.id)}
                          />
                        ) : (
                          <span>{(tab.title || 'N').slice(0, 1)}</span>
                        )}
                      </div>
                      <div className="sidebar__tab-title">{tab.title || 'New Tab'}</div>
                    </div>
                  </div>
                  <div className="sidebar__tab-actions">
                    {/*<button
                      type="button"
                      className={`sidebar__tab-action${isSplitMember ? ' is-active' : ''}`}
                      title="Open in split view"
                      aria-label="Open in split view"
                      onClick={event => {
                        event.stopPropagation();
                        openTabInSplit(tab.id);
                      }}
                    >
                      ⧉
                    </button>*/}
                    <button
                      type="button"
                      className="sidebar__tab-action"
                      title="Move to space"
                      aria-label="Move to space"
                      disabled={spaces.length <= 1}
                      onClick={event => {
                        event.stopPropagation();
                        if (spaces.length <= 1) return;
                        setSpaceMenuTabId(current => (current === tab.id ? null : tab.id));
                      }}
                    >
                      ⋯
                    </button>
                    <button
                      type="button"
                      className="sidebar__tab-close"
                      aria-label="Close tab"
                      onClick={event => {
                        event.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {spaceMenuTabId === tab.id && spaces.length > 1 && (
                    <div
                      className="sidebar__tab-menu"
                      role="menu"
                      onClick={event => event.stopPropagation()}
                    >
                      {spaces
                        .filter(space => space.id !== tab.spaceId)
                        .map(space => (
                          <button
                            key={space.id}
                            type="button"
                            className="sidebar__tab-menu-item"
                            onClick={event => {
                              event.stopPropagation();
                              setSpaceMenuTabId(null);
                              moveTabToSpace(tab.id, space.id, tab.isActive);
                            }}
                          >
                            <span
                              className="sidebar__tab-menu-dot"
                              style={{ backgroundColor: space.color }}
                              aria-hidden="true"
                            />
                            {space.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="sidebar__footer">
          <button
            type="button"
            className="sidebar__settings-button"
            onClick={handleOpenSettings}
          >
            ⚙ Settings
          </button>
        </div>
      </aside>

      <main className="main-area">
        <div className="main-toolbar">
          <div className="main-toolbar__input-wrapper">
            <input
              ref={addressInputRef}
              className="main-toolbar__input"
              placeholder="주소 또는 명령 입력…"
              value={addressValue}
              onFocus={event => {
                setIsAddressFocused(true);
                event.currentTarget.select();
              }}
              onBlur={() => {
                // Delay to allow click on suggestion
                setTimeout(() => setIsAddressFocused(false), 200);
              }}
              onChange={event => setAddressValue(event.target.value)}
              onKeyDown={handleAddressKeyDown}
            />
            {addressSuggestions.length > 0 && isAddressFocused && (
              <div className="address-suggestions">
                {addressSuggestions.map((suggestion, index) => (
                  <div
                    key={suggestion.id}
                    className={`address-suggestion${index === selectedSuggestionIndex ? ' is-selected' : ''}`}
                    onMouseDown={event => {
                      event.preventDefault();
                      setAddressValue(suggestion.url);
                      setAddressSuggestions([]);
                      setSelectedSuggestionIndex(-1);
                      if (!activeTab) return;
                      updateTabById(activeTab.id, tab => ({
                        ...tab,
                        url: suggestion.url,
                        title: suggestion.title,
                        isLoading: true,
                        updatedAt: Date.now(),
                      }));
                      addressInputRef.current?.blur();
                    }}
                  >
                    {suggestion.favicon && (
                      <img
                        src={suggestion.favicon}
                        alt=""
                        className="address-suggestion__favicon"
                        onError={e => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <div className="address-suggestion__content">
                      <div className="address-suggestion__title">{suggestion.title}</div>
                      <div className="address-suggestion__url">{suggestion.url}</div>
                    </div>
                    <div className="address-suggestion__meta">
                      {suggestion.visitCount > 1 && (
                        <span className="address-suggestion__visits">{suggestion.visitCount} visits</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="main-toolbar__actions">
            <button
              className="main-toolbar__button"
              type="button"
              onClick={handleGoBack}
              disabled={!activeTab?.canGoBack}
            >
              〈
            </button>
            <button
              className="main-toolbar__button"
              type="button"
              onClick={handleGoForward}
              disabled={!activeTab?.canGoForward}
            >
              〉
            </button>
            <button
              className="main-toolbar__button"
              type="button"
              onClick={handleReload}
              data-loading={activeTab?.isLoading ? 'true' : 'false'}
            >
              <span className="main-toolbar__icon">↻</span>
            </button>
            <button
              className={`main-toolbar__button${adblockEnabled ? ' is-active' : ''}`}
              type="button"
              onClick={handleToggleAdblockPanel}
              title={adblockButtonTitle}
              data-adblock-enabled={adblockEnabled ? 'true' : 'false'}
              aria-expanded={isAdblockPanelOpen ? 'true' : 'false'}
              aria-haspopup="dialog"
            >
              ⊘
            </button>
            <button
              className={`main-toolbar__button${activePassGuard.active ? ' is-active' : ''}`}
              type="button"
              onClick={handleTogglePassGuardPanel}
              title={passGuardTooltip}
              data-passguard-source={activePassGuard.source}
              data-passguard-override={activePassGuard.source === 'manual' ? 'true' : 'false'}
              aria-expanded={isPassGuardPanelOpen ? 'true' : 'false'}
              aria-haspopup="dialog"
            >
              ⛊
            </button>
            <span className="main-toolbar__divider" aria-hidden="true" />
            <div className="main-toolbar__split-group">
              <button
                className={`main-toolbar__button${activeSplit.isSplit ? ' is-active' : ''}`}
                type="button"
                onClick={toggleSplitView}
                aria-pressed={activeSplit.isSplit}
                title="Toggle split view"
                disabled={!canSplit}
              >
                ⧉
              </button>
              <button
                className="main-toolbar__button"
                type="button"
                onClick={() => focusSplitPane('primary')}
                title="Focus left pane"
                disabled={!activeSplit.isSplit || !primaryTab}
              >
                ◧
              </button>
              <button
                className="main-toolbar__button"
                type="button"
                onClick={() => focusSplitPane('secondary')}
                title="Focus right pane"
                disabled={!activeSplit.isSplit || !secondaryTab}
              >
                ◨
              </button>
              <button
                className="main-toolbar__button"
                type="button"
                onClick={swapSplitPanes}
                title="Swap panes"
                disabled={!activeSplit.isSplit || !primaryTab || !secondaryTab}
              >
                ⇆
              </button>
            </div>
            <span className="main-toolbar__divider" aria-hidden="true" />
            <div className="profile-menu">
              <button
                className="profile-menu__avatar"
                type="button"
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                title={activeProfile?.name || 'Profile'}
                style={{ backgroundColor: activeProfile?.color }}
              >
                {activeProfile?.icon || (activeProfile?.name?.[0] || 'U')}
              </button>
              {isProfileMenuOpen && (
                <div className="profile-menu__dropdown">
                  <div className="profile-menu__section">
                    <div className="profile-menu__label">Profiles</div>
                    {profiles.map(profile => (
                      <button
                        key={profile.id}
                        type="button"
                        className={`profile-menu__item${activeProfile?.id === profile.id ? ' is-active' : ''}`}
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          // Open profile in new window if different from current
                          if (profile.id !== activeProfile?.id) {
                            window.sylph?.openProfileWindow(profile.id);
                          }
                        }}
                      >
                        <div
                          className="profile-menu__item-avatar"
                          style={{ backgroundColor: profile.color }}
                        >
                          {profile.icon || profile.name[0]}
                        </div>
                        <span className="profile-menu__item-name">{profile.name}</span>
                        {profile.isIncognito && (
                          <span className="profile-menu__item-badge">Incognito</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="profile-menu__divider" />
                  <button
                    type="button"
                    className="profile-menu__item"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      setIsAddProfileModalOpen(true);
                      setNewProfileName('');
                    }}
                  >
                    <span className="profile-menu__item-icon">+</span>
                    <span className="profile-menu__item-name">Add New Profile</span>
                  </button>
                  <button
                    type="button"
                    className="profile-menu__item"
                    onClick={() => {
                      createIncognitoTab();
                      setIsProfileMenuOpen(false);
                    }}
                  >
                    <span className="profile-menu__item-icon">🕵️</span>
                    <span className="profile-menu__item-name">Open Incognito</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className={`browser-view${isAutomationActive ? ' automation-active' : ''}${activeSplit.isSplit ? ' is-split' : ''}`}
          style={browserViewStyle}
        >
          {tabs.map(tab => {
            let pane: 'primary' | 'secondary' | 'hidden' = 'hidden';
            if (primaryTab && tab.id === primaryTab.id) {
              pane = 'primary';
            } else if (secondaryTab && tab.id === secondaryTab.id) {
              pane = 'secondary';
            }

            // Get partition from profile
            const profile = profiles.find(p => p.id === tab.profileId);
            const partition = profile?.partition || 'persist:sylph';

            return (
              <webview
                key={tab.id}
                ref={element => handleWebviewRef(tab.id, element)}
                src={tab.url || homePageUrl || DEFAULT_HOME_URL}
                partition={partition}
                useragent={DEFAULT_USER_AGENT}
                allowpopups={true}
                webpreferences="nativeWindowOpen=no"
                data-pane={pane}
                data-active={tab.isActive ? 'true' : 'false'}
              />
            );
          })}

          {(!primaryTab || tabs.length === 0) && (
            <div className="browser-view__placeholder browser-view__placeholder--primary">
              Open a tab to get started.
            </div>
          )}

          {activeSplit.isSplit && !secondaryTab && (
            <div className="browser-view__placeholder browser-view__placeholder--secondary">
              Choose a tab to fill the split view.
            </div>
          )}

          {activeSplit.isSplit && (
            <div
              className="browser-view__split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize split panes"
              onPointerDown={handleSplitResizerPointerDown}
            />
          )}

          {isAutomationActive && currentAutomationStep && (
            <div className="automation-overlay">
              <span className="automation-overlay__spinner" aria-hidden="true" />
              <span className="automation-overlay__label">
                {currentAutomationStep.label}
              </span>
            </div>
          )}
        </div>
      </main>
      {!isAiCollapsed && (
        <div
          className="ai-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Aether panel"
          onPointerDown={handleResizerPointerDown}
        />
      )}

      <aside
        className={`ai-panel${isAiCollapsed ? ' is-collapsed' : ''}`}
        style={{ width: isAiCollapsed ? 0 : aiPanelWidth }}
        aria-hidden={isAiCollapsed}
      >
        <div className="ai-panel__inner">
          <div className="ai-panel__header">
            <div className="ai-panel__header-main">
              <h2>Sylph Aether</h2>
              <span className="ai-panel__status">beta</span>
            </div>
            <button
              type="button"
              className="ai-panel__collapse"
              onClick={handleCollapseAiPanel}
              title="Hide Aether panel"
              aria-label="Hide Aether panel"
            >
              ›
            </button>
          </div>
          <div className="ai-panel__body">
            <div className={`ai-panel__context${activeSelectedText ? '' : ' is-empty'}`}>
              <div className="ai-panel__context-label">Selection</div>
              <div className="ai-panel__context-text">
                {activeSelectedText
                  ? activeSelectedText
                  : 'Select text on the page to attach it here automatically.'}
              </div>
            </div>
            {activeAutomation && (
              <div className="ai-automation">
                <div className="ai-automation__header">
                  <div>
                    <div className="ai-automation__title">Automation</div>
                    <div
                      className={`ai-automation__status ai-automation__status--${activeAutomation.status}`}
                    >
                      {formatAutomationStatus(activeAutomation.status)}
                      {activeAutomation.error ? ` — ${activeAutomation.error}` : ''}
                    </div>
                  </div>
                  <div className="ai-automation__header-actions">
                    <button
                      type="button"
                      className="ai-automation__button"
                      onClick={handleCancelAutomation}
                      disabled={isTerminalStatus(activeAutomation.status)}
                    >
                      Stop
                    </button>
                  </div>
                </div>
                {pendingApprovalStep && (
                  <div className="ai-automation__approval">
                    <div className="ai-automation__approval-text">
                      {pendingApprovalStep.label}
                      {pendingApprovalStep.detail?.command?.selector && (
                        <span className="ai-automation__approval-meta">
                          Target: {pendingApprovalStep.detail.command.selector}
                        </span>
                      )}
                    </div>
                    <div className="ai-automation__approval-actions">
                      <button
                        type="button"
                        className="ai-automation__button"
                        onClick={handleRejectAutomationStep}
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        className="ai-automation__button ai-automation__button--primary"
                        onClick={handleApproveAutomationStep}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="ai-panel__messages">
              {activeAiMessages.length === 0 ? (
                <div className="ai-panel__placeholder">
                  Ask about the current page or request an action. Sylph Aether will respond using your OpenAI API key.
                </div>
              ) : (
                activeAiMessages.map(message => {
                  const run = message.runId ? automationRunsById.get(message.runId) ?? null : null;
                  const showAutomationAction =
                    message.role === 'assistant' &&
                    !run &&
                    message.status === 'completed' &&
                    Boolean(message.linkedUserMessageId);
                  const automationActionBusy = automationBootstrapMessageId === message.id;
                  const automationSteps = run ? run.steps.slice(-5) : [];
                  const automationThinking = run ? runIsThinking(run) : false;
                  const messagePending = message.status === 'pending';

                  return (
                    <div
                      key={message.id}
                      className={`ai-message ai-message--${message.role}${
                        message.status === 'error' ? ' is-error' : ''
                      }`}
                    >
                      {messagePending && !message.content ? (
                        <div className="ai-message__content">Thinking…</div>
                      ) : (
                        <div
                          className="ai-message__content"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content || '') }}
                        />
                      )}

                      {(messagePending && message.content) && (
                        <div className="ai-message__status">
                          <span className="ai-message__spinner" aria-hidden="true" />
                          Thinking…
                        </div>
                      )}

                      {run && (
                        <div className="ai-message__automation">
                          <div className="ai-message__automation-header">
                            <span>Automation progress</span>
                            <span
                              className={`ai-message__automation-status ai-message__automation-status--${run.status}`}
                            >
                              {formatAutomationStatus(run.status)}
                            </span>
                          </div>
                          {automationThinking && (
                            <div className="ai-message__automation-thinking">
                              <span className="ai-message__spinner" aria-hidden="true" />
                              Thinking…
                            </div>
                          )}
                          {automationSteps.length > 0 && (
                            <ul className="ai-message__automation-steps">
                              {automationSteps.map(step => (
                                <li
                                  key={step.id}
                                  className={`ai-message__automation-step ai-message__automation-step--${step.status}`}
                                >
                                  <div className="ai-message__automation-step-main">
                                    <span className="ai-message__automation-step-title">{step.label}</span>
                                    <span className="ai-message__automation-step-status">
                                      {formatStepStatus(step.status)}
                                    </span>
                                  </div>
                                  {step.detail?.result && (
                                    <div className="ai-message__automation-step-meta">{step.detail.result}</div>
                                  )}
                                  {step.detail?.error && (
                                    <div className="ai-message__automation-step-meta is-error">
                                      {step.detail.error}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {showAutomationAction && (
                        <div className="ai-message__actions">
                          <button
                            type="button"
                            onClick={() => {
                              void handleAutomationForMessage(message);
                            }}
                            disabled={
                              automationActionBusy || isAiSending || isAutomationActive
                            }
                          >
                            {automationActionBusy ? 'Starting…' : 'Switch to automation'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="ai-panel__composer">
            <textarea
              placeholder="Ask anything about this page..."
              value={composerValue}
              onChange={event => setComposerValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="ai-panel__composer-footer">
              <span className="ai-panel__composer-hint">Cmd/Ctrl+Enter to send</span>
              <div className="ai-panel__composer-controls">
                <select
                  className="ai-panel__composer-select"
                  value={composerMode}
                  onChange={event => setComposerMode(event.target.value as ComposerMode)}
                  disabled={isAiSending || isAutomationActive}
                >
                  <option value="auto">Auto</option>
                  <option value="ask">Ask</option>
                  <option value="agent-thinking">Agent (Thinking)</option>
                  <option value="agent-fast">Agent (Fast)</option>
                </select>
                <button
                  type="button"
                  onClick={handleComposerSubmit}
                  disabled={
                    isAiSending ||
                    !composerValue.trim() ||
                    (isAgentComposerMode(composerMode) && isAutomationActive)
                  }
                >
                  {automationBootstrapMessageId ? 'Starting…' : isAiSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {isAdblockPanelOpen && (
        <div
          className="adblock-panel-backdrop"
          role="presentation"
          onClick={handleAdblockPanelClose}
          style={{
            pointerEvents: isAdblockPickerActive ? 'none' : 'auto',
            opacity: isAdblockPickerActive ? 0 : 1,
            transition: 'opacity 0.15s ease-out',
          }}
        >
          <div
            className="adblock-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Adblocker Control Panel"
            onClick={event => event.stopPropagation()}
            style={{
              pointerEvents: isAdblockPickerActive ? 'none' : 'auto',
            }}
          >
            <div className="adblock-panel__header">
              <div className="adblock-panel__header-text">
                <h3>Adblocker</h3>
                <p>Ghostery 엔진으로 광고와 추적기를 차단합니다.</p>
              </div>
              <button
                type="button"
                className="adblock-panel__close"
                onClick={handleAdblockPanelClose}
                aria-label="Adblocker 패널 닫기"
              >
                ×
              </button>
            </div>
            {adblockError && <div className="adblock-panel__error">{adblockError}</div>}
            {adblockSuccessMessage && (
              <div
                className="adblock-panel__success"
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(79, 178, 118, 0.15)',
                  border: '1px solid rgba(79, 178, 118, 0.3)',
                  color: '#62c78a',
                  fontSize: '13px',
                  marginBottom: '12px',
                }}
              >
                ✓ {adblockSuccessMessage}
              </div>
            )}
            {!adblockState && isAdblockStateLoading ? (
              <div className="adblock-panel__loading">광고 차단 정보를 불러오는 중…</div>
            ) : !adblockState ? (
              <div className="adblock-panel__empty">광고 차단 상태를 불러오지 못했습니다.</div>
            ) : (
              <>
                <div className="adblock-panel__metrics">
                  <div className="adblock-panel__metric">
                    <span className="adblock-panel__metric-value">{adblockTotalBlocked}</span>
                    <span className="adblock-panel__metric-label">누적 차단 수</span>
                  </div>
                  <div className={`adblock-panel__metric${adblockEnabled ? ' is-on' : ' is-off'}`}>
                    <span className="adblock-panel__metric-value">{adblockEnabled ? 'ON' : 'OFF'}</span>
                    <span className="adblock-panel__metric-label">전체 상태</span>
                  </div>
                </div>
                <div className="adblock-panel__section">
                  <div className="adblock-panel__row">
                    <div className="adblock-panel__row-text">
                      <div className="adblock-panel__row-title">전체 보호</div>
                      <div className="adblock-panel__row-sub">네트워크 광고와 스크립트를 차단합니다.</div>
                    </div>
                    <label className={`adblock-switch${adblockEnabled ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={adblockEnabled}
                        onChange={event => handleAdblockToggleEnabled(event.target.checked)}
                      />
                      <span className="adblock-switch__thumb" />
                    </label>
                  </div>
                  <div className="adblock-panel__actions">
                    <button
                      type="button"
                      className="adblock-panel__action"
                      onClick={handleAdblockBlockElement}
                      disabled={!adblockEnabled || !hasActiveWebview || isAdblockPickerActive}
                    >
                      {isAdblockPickerActive ? '요소 선택 중… (Esc)' : '현재 페이지 요소 차단'}
                    </button>
                    <button
                      type="button"
                      className="adblock-panel__action"
                      onClick={handleAdblockClearLog}
                      disabled={adblockRecentBlocked.length === 0}
                    >
                      로그 비우기
                    </button>
                  </div>
                </div>
                <div className="adblock-panel__section">
                  <div className="adblock-panel__section-title">사용자 지정 규칙</div>
                  <div className="adblock-panel__form">
                    <input
                      type="text"
                      value={adblockCustomRuleInput}
                      onChange={event => setAdblockCustomRuleInput(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleAdblockAddRule();
                        }
                      }}
                      placeholder="example.com##.ad-banner"
                    />
                    <button
                      type="button"
                      className="adblock-panel__action"
                      onClick={() => void handleAdblockAddRule()}
                      disabled={!adblockCustomRuleInput.trim()}
                    >
                      추가
                    </button>
                  </div>
                  <ul className="adblock-panel__custom-list">
                    {adblockState.customCosmeticFilters.map(rule => (
                      <li key={rule} className="adblock-panel__custom-item">
                        <code className="adblock-panel__code" title={rule}>
                          {rule}
                        </code>
                        <button
                          type="button"
                          className="adblock-panel__pill"
                          onClick={() => void handleAdblockRemoveRule(rule)}
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                    {adblockState.customCosmeticFilters.length === 0 && (
                      <li className="adblock-panel__empty">등록된 사용자 규칙이 없습니다.</li>
                    )}
                  </ul>
                </div>
                <div className="adblock-panel__section">
                  <div className="adblock-panel__section-title">최근 차단된 요청</div>
                  {adblockRecentBlocked.length === 0 ? (
                    <div className="adblock-panel__empty">최근 차단된 요청이 없습니다.</div>
                  ) : (
                    <ul className="adblock-panel__log">
                      {adblockRecentBlocked.map(entry => (
                        <li key={entry.id} className="adblock-panel__log-item">
                          <div className="adblock-panel__log-url" title={entry.url}>
                            {entry.url}
                          </div>
                          <div className="adblock-panel__log-meta">
                            <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                            <span>{entry.hostname}</span>
                            <span>{entry.type}</span>
                            {entry.filter && (
                              <span className="adblock-panel__log-filter" title={entry.filter}>
                                {entry.filter}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {isPassGuardPanelOpen && (
        <div
          className="passguard-panel-backdrop"
          role="presentation"
          onClick={() => setIsPassGuardPanelOpen(false)}
        >
          <div
            className="passguard-panel"
            role="dialog"
            aria-modal="true"
            aria-label="PassGuard Control Panel"
            ref={passGuardPanelRef}
            onClick={event => event.stopPropagation()}
          >
            <div className="passguard-panel__header">
              <div className="passguard-panel__header-text">
                <h3>PassGuard</h3>
                <p>Enhancing login compatibility with Firefox/Windows fingerprints.</p>
              </div>
              <button
                type="button"
                className="passguard-panel__close"
                onClick={() => setIsPassGuardPanelOpen(false)}
                aria-label="Close PassGuard Panel"
              >
                ×
              </button>
            </div>

            <div className="passguard-panel__section">
              <div className="passguard-panel__row">
                <div className="passguard-panel__row-text">
                  <div className="passguard-panel__row-title">Current Tab Protection</div>
                  <div className="passguard-panel__row-sub">
                    {activeHostname ? activeHostname : 'No Active Tab'}
                  </div>
                </div>
                <label className={`passguard-switch${manualSwitchChecked ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={manualSwitchChecked}
                    onChange={event => handleManualPassGuardChange(event.target.checked)}
                  />
                  <span className="passguard-switch__thumb" />
                </label>
              </div>
              <div className="passguard-panel__actions">
                <button
                  type="button"
                  className="passguard-panel__action"
                  onClick={handleManualPassGuardReset}
                  disabled={!canResetManual}
                >
                  Reset to Auto
                </button>
                <span className="passguard-panel__status">
                  {isManualOverride
                    ? manualSwitchChecked
                      ? 'Manually On'
                      : 'Manually Off'
                    : activePassGuard.active
                    ? 'Automatically On'
                    : 'Automatically Off'}
                </span>
              </div>
            </div>

            <div className="passguard-panel__section">
              <div className="passguard-panel__row">
                <div className="passguard-panel__row-text">
                  <div className="passguard-panel__row-title">Automatic Detection</div>
                  <div className="passguard-panel__row-sub">
                    PassGuard will automatically turn on when it encounters a login page.
                  </div>
                </div>
                <label
                  className={`passguard-switch${passGuardSettings.autoDetectionEnabled ? ' is-on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={passGuardSettings.autoDetectionEnabled}
                    onChange={handleAutoDetectionChange}
                  />
                  <span className="passguard-switch__thumb" />
                </label>
              </div>
              <div className="passguard-panel__lists">
                <div className="passguard-panel__list">
                  <div className="passguard-panel__list-head">
                    <span className="passguard-panel__list-title">Auto Included Domains</span>
                    <button
                      type="button"
                      className="passguard-panel__pill"
                      onClick={handleIncludeHostAdd}
                      disabled={!activeHostname}
                    >
                      {activeHostname ? `${activeHostname} Add` : 'None'}
                    </button>
                  </div>
                  <textarea
                    value={passGuardIncludeDraft}
                    onChange={handleIncludeDraftChange}
                    placeholder={'accounts.google.com\n.mycompany.com'}
                    rows={3}
                  />
                  <div className="passguard-panel__hint">Input a list of domains to automatically include. Separate by newline or comma.</div>
                </div>
                <div className="passguard-panel__list">
                  <div className="passguard-panel__list-head">
                    <span className="passguard-panel__list-title">Auto Excluded Domains</span>
                    <button
                      type="button"
                      className="passguard-panel__pill"
                      onClick={handleExcludeHostAdd}
                      disabled={!activeHostname}
                    >
                      {activeHostname ? `${activeHostname} Add` : 'None'}
                    </button>
                  </div>
                  <textarea
                    value={passGuardExcludeDraft}
                    onChange={handleExcludeDraftChange}
                    placeholder="internal.example.com"
                    rows={3}
                  />
                  <div className="passguard-panel__hint">Domains in this list will be automatically excluded.</div>
                </div>
              </div>
            </div>

            <div className="passguard-panel__section">
              <div className="passguard-panel__section-title">Custom Fingerprint</div>
              <div className="passguard-panel__grid">
                <label className="passguard-field">
                  <span>User Agent (When Active)</span>
                  <input
                    type="text"
                    value={passGuardSettings.customUserAgent}
                    onChange={handleCustomUserAgentChange}
                    placeholder={PASS_GUARD_USER_AGENT}
                  />
                </label>
                <label className="passguard-field">
                  <span>navigator.platform</span>
                  <input
                    type="text"
                    value={passGuardSettings.customPlatform}
                    onChange={handleCustomPlatformChange}
                    placeholder="Win32"
                  />
                </label>
                <label className="passguard-field">
                  <span>navigator.vendor</span>
                  <input
                    type="text"
                    value={passGuardSettings.customVendor}
                    onChange={handleCustomVendorChange}
                    placeholder="(Leave empty for Firefox style)"
                  />
                </label>
                <label className="passguard-field">
                  <span>navigator.productSub</span>
                  <input
                    type="text"
                    value={passGuardSettings.customProductSub}
                    onChange={handleCustomProductSubChange}
                    placeholder="20100101"
                  />
                </label>
                <label className="passguard-field">
                  <span>navigator.appVersion</span>
                  <input
                    type="text"
                    value={passGuardSettings.customAppVersion}
                    onChange={handleCustomAppVersionChange}
                    placeholder="5.0 (Windows)"
                  />
                </label>
                <label className="passguard-field passguard-field--checkbox">
                  <input
                    type="checkbox"
                    checked={passGuardSettings.removeUserAgentData}
                    onChange={handleRemoveUserAgentDataChange}
                  />
                  <span>Hide navigator.userAgentData</span>
                </label>
              </div>
              <div className="passguard-panel__footnote">
                Leaving this empty will use the default Firefox/Windows fingerprint.
              </div>
            </div>
          </div>
        </div>
      )}

      {isAiCollapsed && (
        <button
          type="button"
          className="ai-panel__expand-toggle"
          onClick={handleExpandAiPanel}
          title="Show Aether panel"
        >
          ‹
        </button>
      )}

      {/* Add Profile Modal */}
      {isAddProfileModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddProfileModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Create New Profile</h3>
            <input
              type="text"
              className="modal-input"
              placeholder="Profile name"
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newProfileName.trim()) {
                  const colors = ['#4fb276', '#60a5fa', '#f472b6', '#facc15', '#f97316', '#a78bfa'];
                  const color = colors[Math.floor(Math.random() * colors.length)];
                  createProfile(newProfileName.trim(), color);
                  setIsAddProfileModalOpen(false);
                  setNewProfileName('');
                }
                if (e.key === 'Escape') {
                  setIsAddProfileModalOpen(false);
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button
                type="button"
                className="modal-button modal-button--secondary"
                onClick={() => setIsAddProfileModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-button modal-button--primary"
                onClick={() => {
                  if (newProfileName.trim()) {
                    const colors = ['#4fb276', '#60a5fa', '#f472b6', '#facc15', '#f97316', '#a78bfa'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    createProfile(newProfileName.trim(), color);
                    setIsAddProfileModalOpen(false);
                    setNewProfileName('');
                  }
                }}
                disabled={!newProfileName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
