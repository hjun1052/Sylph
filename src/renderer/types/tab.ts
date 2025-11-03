export type TabAIMessageRole = 'user' | 'assistant';

export type TabAIMessageStatus = 'pending' | 'completed' | 'error';

export interface TabAIMessage {
  id: string;
  role: TabAIMessageRole;
  content: string;
  createdAt: number;
  status: TabAIMessageStatus;
  runId?: string;
  linkedUserMessageId?: string;
}

export interface TabAIContext {
  selectedText?: string;
  lastUsedAt: number;
  messages: TabAIMessage[];
}

export type PassGuardUserOverride = 'on' | 'off';

export interface TabPassGuardState {
  active: boolean;
  source: 'auto' | 'manual';
  reason?: string;
  userOverride?: PassGuardUserOverride;
}

export interface Tab {
  id: string;                    // 고유 식별자
  title: string;                 // 탭 제목
  url: string;                   // 현재 URL
  favicon?: string;             // 파비콘 URL
  spaceId: string;              // 속한 스페이스 ID
  profileId?: string;           // 프로필 ID (세션 분리)
  isActive: boolean;            // 활성 탭 여부
  isLoading: boolean;           // 웹뷰 로딩 중?
  isCrashed: boolean;           // 웹뷰 크래시 여부
  canGoBack: boolean;           // 뒤로 가기 가능 여부
  canGoForward: boolean;        // 앞으로 가기 가능 여부
  incognito?: boolean;          // 시크릿 탭 여부
  isPinned?: boolean;           // 고정 탭 여부
  isMuted?: boolean;            // 음소거 여부
  history: string[];            // 이동 기록
  unread?: boolean;             // 백그라운드 탭에서 변경 발생 여부
  createdAt: number;            // 생성 시각
  updatedAt: number;            // 마지막 상태 갱신 시각
  aiContext?: TabAIContext;     // AI 기능 위한 컨텍스트
  automation?: {
    activeRunId?: string;
    runs: AetherAutomationRun[];
  };
  passGuard?: TabPassGuardState; // PassGuard 상태
}
import type { AetherAutomationRun } from '../../shared/aether';
