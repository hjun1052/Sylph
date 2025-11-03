import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const sections = [
  { id: 'account', label: 'Account' },
  { id: 'general', label: 'General' },
  { id: 'aether', label: 'Aether' },
  { id: 'browsing', label: 'Browsing' },
  { id: 'security', label: 'Security' },
  { id: 'passwords', label: 'Passwords' },
] as const;

type SectionId = typeof sections[number]['id'];

type ToggleRowProps = {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
};

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, value, onChange }) => (
  <div className="settings-list-item">
    <div className="settings-list-copy">
      <div className="settings-list-title">{label}</div>
      {description && <div className="settings-list-description">{description}</div>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`settings-switch ${value ? 'is-on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="settings-switch__thumb" />
    </button>
  </div>
);

const SettingsApp: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('aether');
  const [apiKey, setApiKey] = useState('');
  const [initialApiKey, setInitialApiKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [compactSidebar, setCompactSidebar] = useState(false);
  const [accountSync, setAccountSync] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [historyRetention, setHistoryRetention] = useState(true);
  const [requireMasterPassword, setRequireMasterPassword] = useState(true);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isActive = true;
    const fetchKey = async () => {
      try {
        const stored = await window.sylph?.settings?.getApiKey?.();
        if (!isActive) return;
        setApiKey(stored ?? '');
        setInitialApiKey(stored ?? '');
      } catch (err) {
        console.error('Failed to load stored API key', err);
      }
    };
    fetchKey();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (status === 'saved') {
      const timer = window.setTimeout(() => {
        setStatus('idle');
      }, 2500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBackdropMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      window.close();
    }
  }, []);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const isDirty = useMemo(() => {
    const normalized = apiKey.trim();
    const normalizedInitial = (initialApiKey ?? '').trim();
    return normalized !== normalizedInitial;
  }, [apiKey, initialApiKey]);

  const handleSave = async () => {
    if (!window.sylph?.settings?.setApiKey) return;
    setStatus('saving');
    setError(null);
    try {
      const trimmed = apiKey.trim();
      await window.sylph.settings.setApiKey(trimmed ? trimmed : null);
      setInitialApiKey(trimmed);
      setStatus('saved');
    } catch (err) {
      console.error('Failed to save API key', err);
      setError(err instanceof Error ? err.message : 'Failed to save API key.');
      setStatus('error');
    }
  };

  const handleClear = async () => {
    if (!window.sylph?.settings?.setApiKey) return;
    setStatus('saving');
    setError(null);
    try {
      await window.sylph.settings.setApiKey(null);
      setApiKey('');
      setInitialApiKey('');
      setStatus('saved');
    } catch (err) {
      console.error('Failed to clear API key', err);
      setError(err instanceof Error ? err.message : 'Failed to clear API key.');
      setStatus('error');
    }
  };

  const isConfigured = useMemo(() => Boolean((initialApiKey ?? '').trim()), [initialApiKey]);
  const activeLabel = useMemo(
    () => sections.find(section => section.id === activeSection)?.label ?? 'Settings',
    [activeSection],
  );

  const handleApiKeyPaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    if (!text) return;
    const start = event.currentTarget.selectionStart ?? 0;
    const end = event.currentTarget.selectionEnd ?? start;
    const cursor = start + text.length;
    setApiKey(previous => {
      const next = `${previous.slice(0, start)}${text}${previous.slice(end)}`;
      window.requestAnimationFrame(() => {
        const input = apiKeyInputRef.current;
        if (input) {
          input.setSelectionRange(cursor, cursor);
        }
      });
      return next;
    });
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case 'account':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">Account</h2>
              <p className="settings-section-description">
                Connect Sylph to sync your preferences and manage agent credits.
              </p>
            </div>
            <div className="settings-callout">
              <div className="settings-callout__title">No account linked</div>
              <div className="settings-callout__description">
                Sign in to unlock cross-device sync and shared Aether usage history.
              </div>
              <div className="settings-callout__actions">
                <button type="button" className="settings-button settings-button--primary">
                  Sign in
                </button>
                <button type="button" className="settings-button" disabled>
                  Disconnect
                </button>
              </div>
            </div>
            <div className="settings-list">
              <ToggleRow
                label="Sync settings across devices"
                description="Keep your preferences identical when using Sylph elsewhere."
                value={accountSync}
                onChange={setAccountSync}
              />
            </div>
          </div>
        );
      case 'general':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">General</h2>
              <p className="settings-section-description">
                Choose how Sylph behaves at launch and how the interface looks.
              </p>
            </div>
            <div className="settings-list">
              <ToggleRow
                label="Launch Sylph at login"
                description="Start automatically when you sign in to macOS."
                value={autoLaunch}
                onChange={setAutoLaunch}
              />
              <ToggleRow
                label="Compact tab sidebar"
                description="Reduce spacing to fit more tabs in the navigation list."
                value={compactSidebar}
                onChange={setCompactSidebar}
              />
            </div>
          </div>
        );
      case 'aether':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">Aether</h2>
              <p className="settings-section-description">
                Configure Aether&apos;s OpenAI access and automation behaviour.
              </p>
            </div>
            <label className="settings-field">
              <span className="settings-field__label">OpenAI API key</span>
              <div className="settings-field__control">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="settings-field__input"
                  ref={apiKeyInputRef}
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={event => setApiKey(event.target.value)}
                  onPaste={handleApiKeyPaste}
                  autoFocus
                />
                <button
                  type="button"
                  className="settings-inline-button"
                  onClick={() => setShowApiKey(previous => !previous)}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <span className="settings-field__hint">
                Stored locally inside your Sylph profile. Generate keys from the{' '}
                <a
                  href="https://platform.openai.com/settings/organization/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI dashboard
                </a>
                .
              </span>
            </label>
            <div className="settings-list">
              <ToggleRow
                label="Attach page context automatically"
                description="Include the current URL and selection when you talk to Aether."
                value={autoCapture}
                onChange={setAutoCapture}
              />
              <ToggleRow
                label="Auto-approve low risk actions"
                description="Allow scrolling or reading actions without an approval prompt."
                value={autoApprove}
                onChange={setAutoApprove}
              />
            </div>
            <div className="settings-actions">
              <div className="settings-status-group">
                {status === 'saving' && (
                  <span className="settings-status-message settings-status-message--muted">Saving…</span>
                )}
                {status === 'saved' && (
                  <span className="settings-status-message settings-status-message--success">Saved</span>
                )}
                {status === 'error' && error && (
                  <span className="settings-status-message settings-status-message--error">{error}</span>
                )}
                {status === 'idle' && !isConfigured && (
                  <span className="settings-status-message settings-status-message--muted">
                    No key saved
                  </span>
                )}
              </div>
              <div className="settings-actions__buttons">
                <button
                  type="button"
                  className="settings-button"
                  onClick={handleClear}
                  disabled={status === 'saving' || (!apiKey && !initialApiKey)}
                >
                  Remove key
                </button>
                <button
                  type="button"
                  className="settings-button settings-button--primary"
                  onClick={handleSave}
                  disabled={!isDirty || status === 'saving'}
                >
                  {status === 'saving' ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        );
      case 'browsing':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">Browsing</h2>
              <p className="settings-section-description">
                Adjust how Sylph captures and shares context while you explore the web.
              </p>
            </div>
            <div className="settings-list">
              <ToggleRow
                label="Paste selection into prompts"
                description="Offer highlighted text to Aether automatically when you ask a question."
                value={autoCapture}
                onChange={setAutoCapture}
              />
              <ToggleRow
                label="Allow background tab automation"
                description="Permit Aether to interact with tabs that are not currently focused."
                value={autoApprove}
                onChange={setAutoApprove}
              />
            </div>
          </div>
        );
      case 'security':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">Security &amp; privacy</h2>
              <p className="settings-section-description">
                Decide how much data Sylph keeps locally and how it presents sensitive information.
              </p>
            </div>
            <div className="settings-list">
              <ToggleRow
                label="Privacy mode"
                description="Hide page titles and URLs in the sidebar until you focus Sylph."
                value={privacyMode}
                onChange={setPrivacyMode}
              />
              <ToggleRow
                label="Keep local browsing history"
                description="Disable to drop navigation traces after tabs close."
                value={historyRetention}
                onChange={setHistoryRetention}
              />
            </div>
          </div>
        );
      case 'passwords':
        return (
          <div className="settings-section">
            <div>
              <h2 className="settings-section-title">Passwords</h2>
              <p className="settings-section-description">
                Configure how password storage and autofill behave inside Sylph.
              </p>
            </div>
            <div className="settings-list">
              <ToggleRow
                label="Require master password"
                description="Prompt for a master password before autofilling credentials."
                value={requireMasterPassword}
                onChange={setRequireMasterPassword}
              />
            </div>
            <div className="settings-callout">
              <div className="settings-callout__title">Password manager</div>
              <div className="settings-callout__description">
                Sylph can reuse the macOS keychain or delegate to an external manager. Integrations are in preview.
              </div>
              <div className="settings-callout__actions">
                <button type="button" className="settings-button">
                  Open keychain
                </button>
                <button type="button" className="settings-button" disabled>
                  Connect 1Password
                </button>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="settings-layer" onMouseDown={handleBackdropMouseDown}>
      <div
        className="settings-panel"
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <header className="settings-panel__header">
          <div>
            <h1>Settings</h1>
            <p>{activeLabel} preferences</p>
          </div>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={handleClose}>
            ✕
          </button>
        </header>
        <div className="settings-panel__body">
          <nav className="settings-sidebar">
            {sections.map(section => (
              <button
                key={section.id}
                type="button"
                className={`settings-sidebar__item ${activeSection === section.id ? 'is-active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">{renderSection()}</div>
        </div>
      </div>
    </div>
  );
};

export default SettingsApp;
