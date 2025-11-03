export type PassGuardDetectionResult = {
  shouldEnable: boolean;
  reason?: string;
};

export type PassGuardSettings = {
  autoDetectionEnabled: boolean;
  includeHosts: string[];
  excludeHosts: string[];
  customUserAgent: string;
  customPlatform: string;
  customVendor: string;
  customProductSub: string;
  customAppVersion: string;
  removeUserAgentData: boolean;
};

export const PASS_GUARD_SETTINGS_STORAGE_KEY = 'sylph.passGuard.settings';

export const DEFAULT_PASS_GUARD_SETTINGS: PassGuardSettings = {
  autoDetectionEnabled: true,
  includeHosts: [],
  excludeHosts: [],
  customUserAgent: '',
  customPlatform: '',
  customVendor: '',
  customProductSub: '',
  customAppVersion: '',
  removeUserAgentData: true,
};

type PassGuardPattern = {
  reason: string;
  test: (url: URL) => boolean;
};

const hostEquals = (url: URL, host: string) => url.hostname === host;

const hostEndsWith = (url: URL, suffix: string) =>
  url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);

const pathnameIncludesAny = (url: URL, keywords: string[]) =>
  keywords.some(keyword => url.pathname.toLowerCase().includes(keyword));

const normalizeHostPattern = (pattern: string) => pattern.trim().replace(/^\.+/, '').toLowerCase();

const isWildcardPattern = (pattern: string) => pattern.startsWith('.') || pattern.startsWith('*');

const hostMatchesPattern = (url: URL, pattern: string) => {
  const normalized = normalizeHostPattern(pattern);
  if (!normalized) return false;
  if (isWildcardPattern(pattern)) {
    return hostEndsWith(url, normalized);
  }
  if (url.hostname === normalized) return true;
  return url.hostname.endsWith(`.${normalized}`);
};

const PASS_GUARD_PATTERNS: PassGuardPattern[] = [
  {
    reason: 'Google 계정 로그인 페이지 감지',
    test: url =>
      hostEquals(url, 'accounts.google.com') ||
      (hostEndsWith(url, 'google.com') && pathnameIncludesAny(url, ['signin', 'login', 'account'])),
  },
  {
    reason: 'YouTube 계정 인증 페이지 감지',
    test: url => hostEquals(url, 'accounts.youtube.com'),
  },
  {
    reason: 'Microsoft 로그인 페이지 감지',
    test: url =>
      hostEquals(url, 'login.live.com') ||
      hostEquals(url, 'login.microsoftonline.com') ||
      (hostEndsWith(url, 'microsoft.com') && pathnameIncludesAny(url, ['login', 'oauth2', 'srf'])),
  },
  {
    reason: 'Apple ID 로그인 페이지 감지',
    test: url => hostEndsWith(url, 'appleid.apple.com'),
  },
  {
    reason: '네이버 로그인 페이지 감지',
    test: url =>
      hostEquals(url, 'nid.naver.com') ||
      (hostEndsWith(url, 'naver.com') && pathnameIncludesAny(url, ['login', 'signin'])),
  },
  {
    reason: '카카오 로그인 페이지 감지',
    test: url =>
      hostEndsWith(url, 'kakao.com') &&
      (pathnameIncludesAny(url, ['login', 'signin']) || url.searchParams.has('login_ch')),
  },
  {
    reason: 'GitHub 로그인 페이지 감지',
    test: url => hostEquals(url, 'github.com') && url.pathname.startsWith('/login'),
  },
  {
    reason: 'Slack 인증 페이지 감지',
    test: url =>
      hostEndsWith(url, 'slack.com') &&
      (pathnameIncludesAny(url, ['signin', 'oauth']) || url.searchParams.has('redir')),
  },
  {
    reason: 'Notion 인증 페이지 감지',
    test: url => hostEndsWith(url, 'notion.so') && pathnameIncludesAny(url, ['login', 'oauth']),
  },
  {
    reason: 'Chrome Web Store 접근',
    test: url => hostEndsWith(url, 'chromewebstore.google.com') || url.hostname === 'chrome.google.com',
  },
];

export type DetectPassGuardOptions = {
  autoDetectionEnabled?: boolean;
  includeHosts?: string[];
  excludeHosts?: string[];
};

export const sanitizeHostList = (list: string[]): string[] => {
  const unique = new Set<string>();
  list
    .map(item => normalizeHostPattern(item))
    .filter(Boolean)
    .forEach(item => unique.add(item));
  return Array.from(unique.values());
};

export const normalizePassGuardSettings = (
  overrides: Partial<PassGuardSettings> | null | undefined,
): PassGuardSettings => {
  if (!overrides) {
    return { ...DEFAULT_PASS_GUARD_SETTINGS };
  }
  const next: PassGuardSettings = {
    autoDetectionEnabled:
      overrides.autoDetectionEnabled ?? DEFAULT_PASS_GUARD_SETTINGS.autoDetectionEnabled,
    includeHosts: sanitizeHostList(overrides.includeHosts ?? DEFAULT_PASS_GUARD_SETTINGS.includeHosts),
    excludeHosts: sanitizeHostList(overrides.excludeHosts ?? DEFAULT_PASS_GUARD_SETTINGS.excludeHosts),
    customUserAgent: (overrides.customUserAgent ?? DEFAULT_PASS_GUARD_SETTINGS.customUserAgent).trim(),
    customPlatform: (overrides.customPlatform ?? DEFAULT_PASS_GUARD_SETTINGS.customPlatform).trim(),
    customVendor: (overrides.customVendor ?? DEFAULT_PASS_GUARD_SETTINGS.customVendor).trim(),
    customProductSub: (overrides.customProductSub ?? DEFAULT_PASS_GUARD_SETTINGS.customProductSub).trim(),
    customAppVersion: (overrides.customAppVersion ?? DEFAULT_PASS_GUARD_SETTINGS.customAppVersion).trim(),
    removeUserAgentData:
      overrides.removeUserAgentData ?? DEFAULT_PASS_GUARD_SETTINGS.removeUserAgentData,
  };
  return next;
};

export const detectPassGuardTrigger = (
  rawUrl: string | null | undefined,
  options?: DetectPassGuardOptions,
): PassGuardDetectionResult => {
  if (!rawUrl) {
    return { shouldEnable: false };
  }

  try {
    const url = new URL(rawUrl);
    if (!['https:', 'http:'].includes(url.protocol)) {
      return { shouldEnable: false };
    }

    const excludeHosts = sanitizeHostList(options?.excludeHosts ?? []);
    if (excludeHosts.some(pattern => hostMatchesPattern(url, pattern))) {
      return { shouldEnable: false, reason: '사용자 지정 제외 목록' };
    }

    const includeHosts = sanitizeHostList(options?.includeHosts ?? []);
    if (includeHosts.some(pattern => hostMatchesPattern(url, pattern))) {
      return { shouldEnable: true, reason: '사용자 지정 포함 목록' };
    }

    if (options?.autoDetectionEnabled === false) {
      return { shouldEnable: false };
    }

    for (const pattern of PASS_GUARD_PATTERNS) {
      if (pattern.test(url)) {
        return {
          shouldEnable: true,
          reason: pattern.reason,
        };
      }
    }
  } catch {
    // ignore invalid URLs
  }

  return { shouldEnable: false };
};
