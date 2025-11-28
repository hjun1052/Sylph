export type AetherAutomationStatus =
  | 'starting'
  | 'awaiting-approval'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error';

export type AetherAutomationStepStatus =
  | 'pending'
  | 'awaiting-approval'
  | 'approved'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface AutomationWaitOptions {
  selector?: string;
  timeout?: number;
}

export interface AutomationFallbackOptions {
  text?: string;
  strategy?: 'equals' | 'contains';
  attributes?: Record<string, string>;
  index?: number;
}

export interface AutomationCommand {
  action: string;
  selector?: string;
  selectors?: string[];
  index?: number;
  text?: string;
  value?: string;
  checked?: boolean;
  amount?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  wait?: AutomationWaitOptions;
  fallback?: AutomationFallbackOptions;
  note?: string;
  regionSelector?: string;
  options?: Record<string, unknown>;
  clear?: boolean;
  timeout?: number;
  code?: string;
  cell?: string;
  row?: number;
  col?: number;
  url?: string;
  query?: string;
  [key: string]: unknown;
}

export interface AetherAutomationStep {
  id: string;
  label: string;
  description?: string;
  requiresApproval: boolean;
  status: AetherAutomationStepStatus;
  createdAt: number;
  updatedAt: number;
  detail?: {
    command: AutomationCommand;
    result?: string;
    screenshotDataUrl?: string;
    error?: string;
  };
}

export interface AetherAutomationRun {
  id: string;
  tabId: string | null;
  prompt: string;
  status: AetherAutomationStatus;
  steps: AetherAutomationStep[];
  createdAt: number;
  updatedAt: number;
  error?: string;
  mode?: 'auto' | 'ask' | 'agent_thinking' | 'agent_fast';
  hasExploredStructure?: boolean;
}

export type AetherAutomationEvent =
  | { type: 'run-created'; run: AetherAutomationRun }
  | { type: 'run-updated'; run: AetherAutomationRun }
  | { type: 'step-request'; runId: string; tabId: string | null; step: AetherAutomationStep }
  | { type: 'step-updated'; runId: string; tabId: string | null; step: AetherAutomationStep }
  | {
      type: 'step-execute';
      runId: string;
      tabId: string | null;
      step: AetherAutomationStep;
      command: AutomationCommand;
    }
  | { type: 'chat-delta'; runId: string; tabId: string | null; delta: string }
  | { type: 'chat-complete'; runId: string; tabId: string | null; content: string }
  | { type: 'chat-error'; runId: string; tabId: string | null; error: string }
  | { type: 'run-completed'; runId: string; tabId: string | null; status: AetherAutomationStatus; error?: string };

export interface StartAutomationRequest {
  tabId: string | null;
  prompt: string;
  mode?: 'auto' | 'ask' | 'agent_thinking' | 'agent_fast';
  context?: {
    url?: string;
    title?: string;
    selection?: string;
  };
}

export interface AutomationApprovalRequest {
  runId: string;
  stepId: string;
  approved: boolean;
  reason?: string;
}

export interface ReportNavigationRequest {
  runId: string;
  url: string;
}

export interface AutomationCancelRequest {
  runId: string;
  reason?: string;
}

export interface AutomationStepResultPayload {
  runId: string;
  stepId: string;
  success: boolean;
  output: string;
  screenshotDataUrl?: string;
  error?: string;
  data?: Record<string, unknown>;
}
