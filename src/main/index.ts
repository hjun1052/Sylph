import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  session,
} from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { CosmeticFilter, parseFilter } from '@ghostery/adblocker';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import OpenAI from 'openai';
import translate from 'translate-google';
import { createAetherManager } from './aether-manager';
import type {
  AutomationApprovalRequest,
  AutomationCancelRequest,
  AutomationStepResultPayload,
  StartAutomationRequest,
} from '../shared/aether';
import { DEFAULT_ACCEPT_LANGUAGE, DEFAULT_USER_AGENT } from '../shared/network';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string;
declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

type SylphSettings = {
  openaiApiKey?: string;
};

let settingsWindow: BrowserWindow | null = null;

// Profile window management
const profileWindows = new Map<string, BrowserWindow>();

type PassGuardOverrideState = {
  tabId: string;
  userAgent: string;
  active: boolean;
  source: 'auto' | 'manual';
  reason?: string;
  userOverride?: 'on' | 'off';
};

type PassGuardUpdatePayload = PassGuardOverrideState & {
  webContentsId: number | null;
};

const passGuardStateByWebContents = new Map<number, PassGuardOverrideState>();

const SEC_CH_HINT_HEADERS = [
  'Sec-Ch-Ua',
  'Sec-Ch-Ua-Mobile',
  'Sec-Ch-Ua-Platform',
  'Sec-Ch-Ua-Platform-Version',
  'Sec-Ch-Ua-Model',
  'Sec-Ch-Ua-Arch',
  'Sec-Ch-Ua-Bitness',
  'Sec-Ch-Ua-Full-Version',
  'Sec-Ch-Ua-Full-Version-List',
  'Sec-Ch-Ua-Wow64',
];

let adBlocker: ElectronBlocker | null = null;
let extensions: ElectronChromeExtensions | null = null;

type AdblockPersistedSettings = {
  enabled: boolean;
  customCosmeticFilters: string[];
};

type AdblockBlockedEntry = {
  id: string;
  url: string;
  hostname: string;
  type: string;
  tabId?: number;
  filter?: string;
  timestamp: number;
};

const MAX_BLOCKED_LOG_ENTRIES = 200;

let adblockSettings: AdblockPersistedSettings = {
  enabled: true,
  customCosmeticFilters: [],
};
let adblockSettingsLoaded = false;
const customCosmeticFilters = new Map<string, CosmeticFilter>();
const adblockContexts = new Map<Electron.Session, ReturnType<ElectronBlocker['enableBlockingInSession']>>();
let adblockBlockedLog: AdblockBlockedEntry[] = [];
let adblockTotalBlocked = 0;
let adblockBlockCounter = 0;
const adblockSubscribers = new Set<Electron.WebContents>();


const getSettingsFilePath = () => {
  const userData = app.getPath('userData');
  return path.join(userData, 'sylph-settings.json');
};

const getAdblockSettingsPath = () => {
  const userData = app.getPath('userData');
  return path.join(userData, 'adblocker-settings.json');
};

const readSettings = async (): Promise<SylphSettings> => {
  try {
    const filePath = getSettingsFilePath();
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as SylphSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    console.error('Failed to read settings file', error);
    return {};
  }
};

const writeSettings = async (settings: SylphSettings) => {
  const filePath = getSettingsFilePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
};

const loadAdblockSettings = async (): Promise<AdblockPersistedSettings> => {
  if (adblockSettingsLoaded) return adblockSettings;
  try {
    const filePath = getAdblockSettingsPath();
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AdblockPersistedSettings>;
    adblockSettings = {
      enabled: parsed.enabled ?? true,
      customCosmeticFilters: Array.isArray(parsed.customCosmeticFilters)
        ? parsed.customCosmeticFilters.filter(item => typeof item === 'string')
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Failed to load adblocker settings', error);
    }
    adblockSettings = {
      enabled: true,
      customCosmeticFilters: [],
    };
  }
  adblockSettingsLoaded = true;
  return adblockSettings;
};

const saveAdblockSettings = async () => {
  const filePath = getAdblockSettingsPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(adblockSettings, null, 2), 'utf-8');
};

type FetchResponseLike = {
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string) => Promise<FetchResponseLike>;

const ensureAdBlocker = async (): Promise<ElectronBlocker | null> => {
  if (adBlocker) return adBlocker;
  await loadAdblockSettings();
  const nativeFetch = (globalThis as Record<string, unknown>).fetch as
    | ((url: string) => Promise<unknown>)
    | undefined;
  const fetcher: FetchLike | null = typeof nativeFetch === 'function'
    ? async (url: string) => {
        const response = (await nativeFetch(url)) as {
          text: () => Promise<string>;
          arrayBuffer: () => Promise<ArrayBuffer>;
          json: () => Promise<unknown>;
        };
        return {
          text: () => response.text(),
          arrayBuffer: () => response.arrayBuffer(),
          json: () => response.json(),
        };
      }
    : null;
  if (!fetcher) {
    console.warn('Ad blocker: global fetch API unavailable; skipping initialisation.');
    return null;
  }
  try {
    const cachePath = path.join(app.getPath('userData'), 'adblocker.bin');
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetcher, {
      path: cachePath,
      read: fs.readFile,
      write: fs.writeFile,
    });
    adBlocker = blocker;
    blocker.on('request-blocked', (request: { url?: string; hostname?: string; type?: string; tabId?: number }, result: { filter?: { toString?: () => string } | null }) => {
      const entry: AdblockBlockedEntry = {
        id: `blk-${Date.now()}-${++adblockBlockCounter}`,
        url: request?.url ?? 'unknown',
        hostname: request?.hostname ?? 'unknown',
        type: request?.type ?? 'other',
        tabId: typeof request?.tabId === 'number' && Number.isFinite(request.tabId) ? request.tabId : undefined,
        filter:
          typeof result?.filter?.toString === 'function'
            ? result.filter.toString()
            : undefined,
        timestamp: Date.now(),
      };
      recordBlockedRequest(entry);
    });
    rebuildCustomCosmeticFilters(blocker);
    notifyAdblockState();
    return blocker;
  } catch (error) {
    console.error('Failed to initialize ad blocker', error);
    return null;
  }
};

const resolveOpenAIClient = async () => {
  const settings = await readSettings();
  const apiKey = settings.openaiApiKey;
  if (!apiKey) {
    throw new Error('OpenAI API key is not set.');
  }
  return new OpenAI({ apiKey });
};

const parseCosmeticFilterRule = (rule: string): CosmeticFilter | null => {
  const parsed = parseFilter(rule);
  if (!parsed) return null;
  const candidate = parsed as CosmeticFilter & { isCosmeticFilter?: () => boolean };
  if (typeof candidate.isCosmeticFilter === 'function' && candidate.isCosmeticFilter()) {
    return candidate;
  }
  return null;
};

const rebuildCustomCosmeticFilters = (blocker: ElectronBlocker | null) => {
  customCosmeticFilters.clear();
  const validRules: string[] = [];
  for (const rule of adblockSettings.customCosmeticFilters) {
    const filter = parseCosmeticFilterRule(rule);
    if (filter) {
      customCosmeticFilters.set(rule, filter);
      validRules.push(rule);
    } else {
      console.warn('Ignoring invalid custom adblocker rule', rule);
    }
  }
  if (validRules.length !== adblockSettings.customCosmeticFilters.length) {
    adblockSettings.customCosmeticFilters = validRules;
    void saveAdblockSettings();
  }
  if (blocker && customCosmeticFilters.size > 0) {
    blocker.update({ newCosmeticFilters: Array.from(customCosmeticFilters.values()) });
  }
};

const broadcastAdblockEvent = (channel: string, payload: unknown) => {
  for (const contents of Array.from(adblockSubscribers.values())) {
    if (contents.isDestroyed()) {
      adblockSubscribers.delete(contents);
      continue;
    }
    contents.send(channel, payload);
  }
};

const getAdblockState = () => ({
  enabled: adblockSettings.enabled,
  customCosmeticFilters: Array.from(customCosmeticFilters.keys()),
  totalBlocked: adblockTotalBlocked,
  recentBlocked: adblockBlockedLog.slice(-50).reverse(),
});

const notifyAdblockState = () => {
  broadcastAdblockEvent('adblocker:state-changed', getAdblockState());
};

const recordBlockedRequest = (entry: AdblockBlockedEntry) => {
  adblockBlockedLog = [...adblockBlockedLog, entry];
  if (adblockBlockedLog.length > MAX_BLOCKED_LOG_ENTRIES) {
    adblockBlockedLog = adblockBlockedLog.slice(-MAX_BLOCKED_LOG_ENTRIES);
  }
  adblockTotalBlocked += 1;
  broadcastAdblockEvent('adblocker:blocked', {
    entry,
    totalBlocked: adblockTotalBlocked,
  });
};

const clearAdblockLog = () => {
  adblockBlockedLog = [];
  adblockTotalBlocked = 0;
  notifyAdblockState();
};

const setAdblockEnabled = async (enabled: boolean) => {
  await loadAdblockSettings();
  if (adblockSettings.enabled === enabled) {
    return;
  }
  adblockSettings.enabled = enabled;
  await saveAdblockSettings();
  await ensureAdBlocker();
  adblockContexts.forEach(context => {
    if (enabled) {
      context.enable();
    } else {
      context.disable();
    }
  });
  notifyAdblockState();
};

const addCustomCosmeticFilter = async (rule: string) => {
  const normalized = rule.trim();
  if (!normalized) {
    throw new Error('Filter cannot be empty.');
  }
  await loadAdblockSettings();
  if (customCosmeticFilters.has(normalized)) {
    throw new Error('Filter already exists.');
  }
  const filter = parseCosmeticFilterRule(normalized);
  if (!filter) {
    throw new Error('Invalid cosmetic filter.');
  }
  const blocker = await ensureAdBlocker();
  if (!blocker) {
    throw new Error('Ad blocker is not available.');
  }
  customCosmeticFilters.set(normalized, filter);
  blocker.update({ newCosmeticFilters: [filter] });
  adblockSettings.customCosmeticFilters = Array.from(customCosmeticFilters.keys());
  await saveAdblockSettings();
  notifyAdblockState();
};

const removeCustomCosmeticFilter = async (rule: string) => {
  const blocker = await ensureAdBlocker();
  if (!blocker) {
    throw new Error('Ad blocker is not available.');
  }
  const existing = customCosmeticFilters.get(rule);
  if (!existing) {
    throw new Error('Filter does not exist.');
  }
  blocker.update({ removedCosmeticFilters: [existing.getId()] });
  customCosmeticFilters.delete(rule);
  adblockSettings.customCosmeticFilters = Array.from(customCosmeticFilters.keys());
  await saveAdblockSettings();
  notifyAdblockState();
};

const attachAdblockerToSession = async (target: Electron.Session | null | undefined) => {
  if (!target) return;
  const blocker = await ensureAdBlocker();
  if (!blocker) return;
  const previous = adblockContexts.get(target);
  if (previous) {
    // Already attached, skip to avoid duplicate IPC handler registration
    return;
  }
  const context = blocker.enableBlockingInSession(target);
  adblockContexts.set(target, context);
  if (!adblockSettings.enabled) {
    context.disable();
  }
};

const aetherManager = createAetherManager(resolveOpenAIClient);

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

app.on('session-created', newSession => {
  configureSessionHeaders(newSession);
  void attachAdblockerToSession(newSession);
});

const configureSessionHeaders = (target: Electron.Session | null | undefined) => {
  if (!target) return;
  const marker = target as { __sylphHeadersPatched?: boolean };
  if (marker.__sylphHeadersPatched) return;

  target.setUserAgent(DEFAULT_USER_AGENT);
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const override =
      typeof details.webContentsId === 'number'
        ? passGuardStateByWebContents.get(details.webContentsId)
        : undefined;
    headers['User-Agent'] = override?.userAgent ?? DEFAULT_USER_AGENT;
    if (!headers['Accept-Language']) {
      headers['Accept-Language'] = DEFAULT_ACCEPT_LANGUAGE;
    }
    for (const header of SEC_CH_HINT_HEADERS) {
      if (header in headers) {
        delete headers[header];
      }
    }
    callback({ cancel: false, requestHeaders: headers });
  });
  marker.__sylphHeadersPatched = true;
};

const setupExtensions = () => {
  const sylphSession = session.fromPartition('persist:sylph');

  extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: sylphSession,
    createTab: async (details) => {
      // Notify renderer to create a new tab
      const windows = BrowserWindow.getAllWindows();
      const targetWindow = windows.find(w => !w.isDestroyed()) || null;
      if (!targetWindow) {
        throw new Error('No window available to create tab');
      }

      // Send IPC to renderer to create tab
      targetWindow.webContents.send('extensions:create-tab', details);

      // Return placeholder - actual tab will be registered when created
      return [targetWindow.webContents, targetWindow];
    },
    selectTab: (webContents, browserWindow) => {
      if (browserWindow && 'webContents' in browserWindow) {
        (browserWindow as BrowserWindow).webContents.send('extensions:select-tab', { webContentsId: webContents.id });
      }
    },
    removeTab: (webContents, browserWindow) => {
      if (browserWindow && 'webContents' in browserWindow) {
        (browserWindow as BrowserWindow).webContents.send('extensions:remove-tab', { webContentsId: webContents.id });
      }
    },
    createWindow: async (details) => {
      const win = new BrowserWindow({
        width: details.width || 1200,
        height: details.height || 800,
        webPreferences: {
          preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: true,
          session: sylphSession,
        },
      });
      win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
      return win;
    },
    removeWindow: async (browserWindow) => {
      browserWindow.close();
      return browserWindow;
    },
  });

  // Handle CRX protocol for extension icons in default session (for UI)
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
};

const configureDefaultSession = () => {
  const defaultSession = session.defaultSession;
  const sylphSession = session.fromPartition('persist:sylph');
  configureSessionHeaders(defaultSession);
  configureSessionHeaders(sylphSession);
  // Attach adblocker (will skip if already attached via session-created event)
  void attachAdblockerToSession(defaultSession);
  void attachAdblockerToSession(sylphSession);
  setupExtensions();
};

const createWindow = (profileId?: string) => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Store profile ID if provided
  if (profileId) {
    profileWindows.set(profileId, win);
    win.on('closed', () => {
      profileWindows.delete(profileId);
    });
  }

  // Pass profileId to renderer via query string
  const url = profileId
    ? `${MAIN_WINDOW_WEBPACK_ENTRY}?profileId=${encodeURIComponent(profileId)}`
    : MAIN_WINDOW_WEBPACK_ENTRY;

  win.loadURL(url);

  setupWindowContextMenu(win);

  return win;
};

const ensureSettingsWindow = (parent?: BrowserWindow | null) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 640,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: 'Settings',
    parent: parent ?? undefined,
    modal: Boolean(parent),
    webPreferences: {
      preload: SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  settingsWindow.loadURL(SETTINGS_WINDOW_WEBPACK_ENTRY);
  return settingsWindow;
};

app.whenReady().then(() => {
  configureDefaultSession();
  createApplicationMenu();
  setupWebviewContextMenus();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const createApplicationMenu = () => {
  const sendActionToWindow = (window: BrowserWindow | undefined | null, action: string) => {
    window?.webContents.send('app-action', { action });
  };

  const isMac = process.platform === 'darwin';

  const macAppMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ] as MenuItemConstructorOptions[],
        },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'new-tab'),
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'reopen-closed-tab'),
        },
        { type: 'separator' as const },
        {
          label: 'Close Tab',
          accelerator: isMac ? 'CmdOrCtrl+W' : 'Ctrl+F4',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'close-tab'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Tab',
          accelerator: 'CmdOrCtrl+R',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'reload'),
        },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'focus-address-bar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Back',
          accelerator: isMac ? 'CmdOrCtrl+[' : 'Alt+Left',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'go-back'),
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'CmdOrCtrl+]' : 'Alt+Right',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'go-forward'),
        },
        { type: 'separator' as const },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          acceleratorWorksWhenHidden: true,
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'select-next-tab'),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          acceleratorWorksWhenHidden: true,
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            sendActionToWindow(browserWindow, 'select-previous-tab'),
        },
        ...(isMac
          ? [
              {
                label: 'Next Tab (Alt+Command+Right)',
                accelerator: 'Alt+Command+Right',
                acceleratorWorksWhenHidden: true,
                visible: false,
                click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
                  sendActionToWindow(browserWindow, 'select-next-tab'),
              },
              {
                label: 'Previous Tab (Alt+Command+Left)',
                accelerator: 'Alt+Command+Left',
                acceleratorWorksWhenHidden: true,
                visible: false,
                click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
                  sendActionToWindow(browserWindow, 'select-previous-tab'),
              },
            ]
          : []),
      ],
    },
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined) =>
            browserWindow?.webContents.toggleDevTools(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const setupWindowContextMenu = (window: BrowserWindow) => {
  const sendAction = (action: string) => {
    window.webContents.send('app-action', { action });
  };

  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault();
    const editItems: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: 'undo' as const },
          { role: 'redo' as const },
          { type: 'separator' as const },
          { role: 'cut' as const },
          { role: 'copy' as const },
          { role: 'paste' as const },
          { role: 'selectAll' as const },
        ]
      : [{ role: 'copy' as const }, { role: 'selectAll' as const }];

    const template: MenuItemConstructorOptions[] = [
      {
        label: 'New Tab',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendAction('new-tab'),
      },
      {
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendAction('close-tab'),
      },
      { type: 'separator' },
      {
        label: 'Reload Tab',
        click: () => sendAction('reload'),
      },
      {
        label: 'Focus Address Bar',
        accelerator: 'CmdOrCtrl+L',
        click: () => sendAction('focus-address-bar'),
      },
      { type: 'separator' },
      ...editItems,
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window });
  });
};

const setupWebviewContextMenus = () => {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    contents.once('destroyed', () => {
      passGuardStateByWebContents.delete(contents.id);
    });

    contents.setWindowOpenHandler((details) => {
      const parentWebContents = contents.hostWebContents;
      if (parentWebContents && !parentWebContents.isDestroyed()) {
        parentWebContents.send('webview:new-window', {
          url: details.url,
          disposition: details.disposition,
          frameName: details.frameName,
        });
      }
      return { action: 'deny' };
    });

    contents.on('context-menu', (contextEvent, params) => {
      contextEvent.preventDefault();

      const parentWebContents = contents.hostWebContents ?? contents;
      const parentWindow = BrowserWindow.fromWebContents(parentWebContents);

      const editItems: MenuItemConstructorOptions[] = params.isEditable
        ? [{ role: 'paste' as const }]
        : [];

      const linkItems: MenuItemConstructorOptions[] = params.linkURL
        ? [
            {
              label: 'Open Link in New Tab',
              click: () => {
                if (parentWebContents && !parentWebContents.isDestroyed()) {
                  parentWebContents.send('webview:open-link-in-new-tab', {
                    url: params.linkURL,
                  });
                }
              },
            },
            { type: 'separator' },
            {
              label: 'Copy Link Address',
              click: () => {
                const { clipboard } = require('electron');
                clipboard.writeText(params.linkURL);
              },
            },
            { type: 'separator' },
          ]
        : [];

      const template: MenuItemConstructorOptions[] = [
        ...linkItems,
        {
          label: 'Back',
          enabled: contents.canGoBack(),
          click: () => contents.goBack(),
        },
        {
          label: 'Forward',
          enabled: contents.canGoForward(),
          click: () => contents.goForward(),
        },
        {
          label: 'Reload',
          click: () => contents.reload(),
        },
        { type: 'separator' },
        { role: 'copy' as const },
        ...editItems,
        { type: 'separator' as const },
        {
          label: 'Open DevTools',
          click: () => contents.openDevTools({ mode: 'detach' }),
        },
      ];

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: parentWindow ?? undefined });
    });
  });
};

ipcMain.handle('get-home-page-url', () => {
  const homePath = path.join(app.getAppPath(), 'home.html');
  return pathToFileURL(homePath).toString();
});

ipcMain.handle('open-settings-window', event => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  ensureSettingsWindow(parent);
});

ipcMain.handle('open-profile-window', (_event, profileId: string) => {
  // Check if window already exists for this profile
  const existingWindow = profileWindows.get(profileId);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return;
  }

  // Create new window for this profile
  createWindow(profileId);
});

ipcMain.on('adblocker:subscribe', event => {
  const contents = event.sender;
  adblockSubscribers.add(contents);
  contents.once('destroyed', () => {
    adblockSubscribers.delete(contents);
  });
  void ensureAdBlocker().then(() => {
    if (!contents.isDestroyed()) {
      contents.send('adblocker:state-changed', getAdblockState());
    }
  });
});

ipcMain.on('adblocker:unsubscribe', event => {
  adblockSubscribers.delete(event.sender);
});

ipcMain.handle('adblocker:get-state', async () => {
  await ensureAdBlocker();
  return getAdblockState();
});

ipcMain.handle('adblocker:set-enabled', async (_event, payload: { enabled: boolean } | undefined) => {
  await setAdblockEnabled(Boolean(payload?.enabled));
  return getAdblockState();
});

ipcMain.handle(
  'adblocker:add-cosmetic-filter',
  async (_event, payload: { rule?: string } | undefined) => {
    try {
      await addCustomCosmeticFilter(String(payload?.rule ?? ''));
      return { success: true, state: getAdblockState() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  'adblocker:remove-cosmetic-filter',
  async (_event, payload: { rule?: string } | undefined) => {
    try {
      await removeCustomCosmeticFilter(String(payload?.rule ?? ''));
      return { success: true, state: getAdblockState() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle('adblocker:clear-log', async () => {
  clearAdblockLog();
  return getAdblockState();
});

ipcMain.handle('passguard:update', (_event, payload: PassGuardUpdatePayload | undefined) => {
  if (!payload) return;
  const { webContentsId, active, userAgent, tabId, source, reason, userOverride } = payload;
  if (typeof webContentsId !== 'number') {
    return;
  }
  if (!active) {
    passGuardStateByWebContents.delete(webContentsId);
    return;
  }
  passGuardStateByWebContents.set(webContentsId, {
    tabId,
    userAgent,
    active,
    source,
    reason,
    userOverride,
  });
});

ipcMain.handle('settings:get-api-key', async () => {
  const settings = await readSettings();
  return settings.openaiApiKey ?? null;
});

ipcMain.handle(
  'settings:set-api-key',
  async (_event, payload: { key: string | null } | undefined) => {
    const nextKey = payload?.key ?? null;
    const settings = await readSettings();
    if (nextKey) {
      settings.openaiApiKey = nextKey;
    } else {
      delete settings.openaiApiKey;
    }
    await writeSettings(settings);
  },
);

ipcMain.handle(
  'ai:send-prompt',
  async (_event, payload: {
    prompt: string;
    tabId: string | null;
    tabContext?: {
      url?: string;
      title?: string;
      selectedText?: string;
    };
  }) => {
    try {
      if (!payload?.prompt?.trim()) {
        return { success: false, error: 'Prompt is empty.' };
      }
      const client = await resolveOpenAIClient();
      const promptSections: string[] = [];
      const { tabContext } = payload;
      if (tabContext?.url || tabContext?.title) {
        const urlLine = tabContext.url ? `URL: ${tabContext.url}` : '';
        const titleLine = tabContext.title ? `Title: ${tabContext.title}` : '';
        const header = [titleLine, urlLine].filter(Boolean).join('\n');
        if (header) {
          promptSections.push(header);
        }
      }
      if (tabContext?.selectedText) {
        promptSections.push(`Selected text:\n${tabContext.selectedText}`);
      }
      promptSections.push(payload.prompt);

      const response = await client.responses.create({
        model: 'gpt-4o-mini',
        input: promptSections.join('\n\n'),
      });

      const outputText = (response as { output_text?: string }).output_text;
      if (outputText) {
        return { success: true, output: outputText };
      }

      return { success: true, output: 'Response received with no text.' };
    } catch (error) {
      console.error('OpenAI prompt failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
);

ipcMain.handle('aether:start-run', (event, payload: StartAutomationRequest) => {
  return aetherManager.startRun(event.sender, payload);
});

ipcMain.handle('aether:submit-approval', (_event, payload: AutomationApprovalRequest) => {
  return aetherManager.submitApproval(payload);
});

ipcMain.handle('aether:cancel-run', (_event, payload: AutomationCancelRequest) => {
  return aetherManager.cancelRun(payload);
});

ipcMain.handle('aether:step-result', (_event, payload: AutomationStepResultPayload) => {
  return aetherManager.handleStepResult(payload);
});

ipcMain.handle('show-tab-context-menu', (event, payload) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  requestTabContextMenu(window, payload);
});
const requestTabContextMenu = (
  window: BrowserWindow,
  payload: {
    tabId: string;
    isPinned?: boolean;
    url?: string;
    position: { x: number; y: number };
  },
) => {
  const sendTabAction = (action: string, extra?: Record<string, unknown>) => {
    window.webContents.send('tab-action', {
      action,
      tabId: payload.tabId,
      ...extra,
    });
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: payload.isPinned ? 'Unpin Tab' : 'Pin Tab',
      click: () => sendTabAction(payload.isPinned ? 'unpin' : 'pin'),
    },
    {
      label: 'Duplicate Tab',
      click: () => sendTabAction('duplicate'),
    },
    {
      label: 'Open in New Tab',
      enabled: !!payload.url,
      click: () => sendTabAction('open-in-new-tab'),
    },
    { type: 'separator' },
    {
      label: 'Copy Link Address',
      enabled: !!payload.url,
      click: () => {
        if (payload.url) {
          const { clipboard } = require('electron');
          clipboard.writeText(payload.url);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Close Tab',
      accelerator: 'CmdOrCtrl+W',
      click: () => sendTabAction('close'),
    },
    {
      label: 'Close Other Tabs',
      click: () => sendTabAction('close-others'),
    },
    {
      label: 'Close Tabs to the Right',
      click: () => sendTabAction('close-right'),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window,
    x: Math.round(payload.position.x),
    y: Math.round(payload.position.y),
  });
};

// Extension IPC handlers
ipcMain.handle('extensions:load', async (_event, extensionPath: string) => {
  if (!extensions) {
    throw new Error('Extensions not initialized');
  }
  try {
    const ext = await session.fromPartition('persist:sylph').loadExtension(extensionPath);
    return { success: true, extension: { id: ext.id, name: ext.name, version: (ext as any).version || 0 } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('extensions:unload', async (_event, extensionId: string) => {
  try {
    await session.fromPartition('persist:sylph').removeExtension(extensionId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('extensions:list', async () => {
  try {
    const exts = session.fromPartition('persist:sylph').getAllExtensions();
    return {
      success: true,
      extensions: exts.map(ext => ({
        id: ext.id,
        name: ext.name,
        version: (ext as any).version || 0,
        path: ext.path,
      })),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('extensions:add-tab', async (_event, payload: { webContentsId: number }) => {
  if (!extensions) return;
  const webContents = require('electron').webContents.fromId(payload.webContentsId);
  if (!webContents) return;
  const window = BrowserWindow.fromWebContents(webContents);
  if (!window) return;
  extensions.addTab(webContents, window);
});

ipcMain.handle('extensions:select-tab', async (_event, payload: { webContentsId: number }) => {
  if (!extensions) return;
  const webContents = require('electron').webContents.fromId(payload.webContentsId);
  if (!webContents) return;
  extensions.selectTab(webContents);
});

// Content feature IPC handlers
ipcMain.handle('content:capture-screenshot', async (_event, payload: { webContentsId: number; format?: 'png' | 'jpeg' }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, error: 'WebContents not found' };
    }
    const image = await wc.capturePage();
    const dataUrl = payload.format === 'jpeg'
      ? image.toJPEG(90).toString('base64')
      : image.toPNG().toString('base64');
    return {
      success: true,
      dataUrl: `data:image/${payload.format || 'png'};base64,${dataUrl}`
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('content:save-page', async (_event, payload: { webContentsId: number }) => {
  try {
    const { webContents, dialog } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, error: 'WebContents not found' };
    }
    const window = BrowserWindow.fromWebContents(wc);
    if (!window) {
      return { success: false, error: 'Window not found' };
    }
    const result = await dialog.showSaveDialog(window, {
      filters: [{ name: 'Webpage', extensions: ['html', 'htm'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Save canceled' };
    }
    await wc.savePage(result.filePath, 'HTMLComplete');
    return { success: true, path: result.filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('content:print', async (_event, payload: { webContentsId: number }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, error: 'WebContents not found' };
    }
    wc.print();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('content:toggle-fullscreen', async (_event, payload: { webContentsId: number }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, isFullscreen: false };
    }
    const window = BrowserWindow.fromWebContents(wc);
    if (!window) {
      return { success: false, isFullscreen: false };
    }
    const isFullscreen = !window.isFullScreen();
    window.setFullScreen(isFullscreen);
    return { success: true, isFullscreen };
  } catch (error) {
    return { success: false, isFullscreen: false };
  }
});

ipcMain.handle('content:summarize-page', async (_event, payload: { webContentsId: number; url: string }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, error: 'WebContents not found' };
    }

    // Extract page content
    const content = await wc.executeJavaScript(`
      (function() {
        const title = document.title;
        const body = document.body.innerText.substring(0, 10000);
        return { title, body };
      })()
    `);

    // Use AI to summarize
    const settings = await readSettings();
    const apiKey = settings.openaiApiKey;
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Summarize the following webpage in 2-3 sentences:\n\nTitle: ${content.title}\n\nContent: ${content.body}`
        }
      ],
      max_tokens: 200,
    });

    const summary = response.choices[0]?.message?.content || '';
    return { success: true, summary };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('content:translate-page', async (_event, payload: { webContentsId: number; url: string; targetLang?: string }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(payload.webContentsId);
    if (!wc) {
      return { success: false, error: 'WebContents not found' };
    }

    // Extract page content
    const content = await wc.executeJavaScript(`
      (function() {
        const title = document.title;
        const body = document.body.innerText.substring(0, 5000);
        return { title, body };
      })()
    `);

    // Use translate-google to translate
    const targetLang = payload.targetLang || 'ko'; // Korean language code

    // Translate title and body separately
    const translatedTitle = await translate(content.title, { to: targetLang });
    const translatedBody = await translate(content.body, { to: targetLang });

    const translation = `${translatedTitle}\n\n${translatedBody}`;
    return { success: true, translation };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('content:summarize-url', async (_event, payload: { url: string }) => {
  try {
    const settings = await readSettings();
    const apiKey = settings.openaiApiKey;
    if (!apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Based on the URL "${payload.url}", provide a brief 1-sentence prediction of what this page might contain.`
        }
      ],
      max_tokens: 100,
    });

    const summary = response.choices[0]?.message?.content || '';
    return { success: true, summary };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Download management
const activeDownloads = new Map<string, any>();

ipcMain.handle('download:pause', async (_event, payload: { id: string }) => {
  const item = activeDownloads.get(payload.id);
  if (item && item.canResume()) {
    item.pause();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('download:resume', async (_event, payload: { id: string }) => {
  const item = activeDownloads.get(payload.id);
  if (item && item.canResume()) {
    item.resume();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('download:cancel', async (_event, payload: { id: string }) => {
  const item = activeDownloads.get(payload.id);
  if (item) {
    item.cancel();
    activeDownloads.delete(payload.id);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('download:open', async (_event, payload: { path: string }) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(payload.path);
    return { success: true };
  } catch (error) {
    return { success: false };
  }
});

ipcMain.handle('download:show-in-folder', async (_event, payload: { path: string }) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(payload.path);
    return { success: true };
  } catch (error) {
    return { success: false };
  }
});

// Webview context menu handler
ipcMain.handle('webview:show-context-menu', async (event, payload: {
  params: Electron.ContextMenuParams;
  webContentsId: number;
  tabId: string;
}) => {
  const { params, webContentsId } = payload;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  const template: MenuItemConstructorOptions[] = [];

  // Standard editing actions
  if (params.misspelledWord) {
    params.dictionarySuggestions.forEach(suggestion => {
      template.push({
        label: suggestion,
        click: () => {
          const wc = require('electron').webContents.fromId(webContentsId);
          if (wc) wc.replaceMisspelling(suggestion);
        }
      });
    });
    if (params.dictionarySuggestions.length > 0) {
      template.push({ type: 'separator' });
    }
  }

  if (params.selectionText) {
    template.push({
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      role: 'copy'
    });
  }

  if (params.editFlags.canCut) {
    template.push({
      label: 'Cut',
      accelerator: 'CmdOrCtrl+X',
      role: 'cut'
    });
  }

  if (params.editFlags.canPaste) {
    template.push({
      label: 'Paste',
      accelerator: 'CmdOrCtrl+V',
      role: 'paste'
    });
  }

  if (params.editFlags.canSelectAll) {
    template.push({
      label: 'Select All',
      accelerator: 'CmdOrCtrl+A',
      role: 'selectAll'
    });
  }

  // AI-powered features
  template.push({ type: 'separator' });

  template.push({
    label: 'Summarize Page',
    click: () => {
      event.sender.send('webview:context-menu-action', {
        action: 'summarize-page',
        webContentsId
      });
    }
  });

  template.push({
    label: 'Translate Page',
    click: () => {
      event.sender.send('webview:context-menu-action', {
        action: 'translate-page',
        webContentsId
      });
    }
  });

  // Link preview
  if (params.linkURL) {
    template.push({ type: 'separator' });
    template.push({
      label: `Preview: ${params.linkURL.substring(0, 50)}${params.linkURL.length > 50 ? '...' : ''}`,
      click: () => {
        event.sender.send('webview:context-menu-action', {
          action: 'preview-url',
          url: params.linkURL
        });
      }
    });
  }

  // Back/Forward/Reload for non-editable areas
  if (!params.isEditable && template.length > 0) {
    template.push({ type: 'separator' });
  }

  if (!params.isEditable) {
    const wc = require('electron').webContents.fromId(webContentsId);
    if (wc) {
      if (wc.canGoBack()) {
        template.push({
          label: 'Back',
          click: () => wc.goBack()
        });
      }
      if (wc.canGoForward()) {
        template.push({
          label: 'Forward',
          click: () => wc.goForward()
        });
      }
      template.push({
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: () => wc.reload()
      });
    }
  }

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window });
});
