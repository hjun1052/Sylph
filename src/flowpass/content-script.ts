/**
 * FlowPass Content Script
 * Injected into webpages to detect forms and enable autofill
 */

type CredentialMatch = {
  entryId: string;
  name: string;
  username: string;
  lastUsedAt: number;
};

type FlowPassBridge = {
  getMatches: (hostname: string) => Promise<CredentialMatch[]>;
  getCredentials: (entryId: string) => Promise<{ username: string; password: string } | null>;
  captureLogin: (data: { host: string; url: string; username: string; password: string }) => Promise<void>;
};

// This file is meant to be injected as a string, not compiled directly
export {};

// Extend window interface
declare global {
  interface Window {
    flowPassBridge?: FlowPassBridge;
  }
}

class FlowPassContentScript {
  private activeIcons: Set<HTMLElement> = new Set();
  private observedForms: Set<HTMLFormElement> = new Set();
  private formObserver: MutationObserver | null = null;
  private pendingCapture: { username: string; password: string } | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  }

  private start() {
    // Scan for existing forms
    this.scanForForms();

    // Watch for dynamically added forms (SPA support)
    this.setupFormObserver();

    // Listen for form submissions
    this.setupFormSubmissionListeners();
  }

  /**
   * Scan document for password fields and inject FlowPass icons
   */
  private scanForForms() {
    const passwordFields = document.querySelectorAll<HTMLInputElement>(
      'input[type="password"]'
    );

    passwordFields.forEach(field => {
      this.processPasswordField(field);
    });
  }

  /**
   * Setup MutationObserver to detect dynamically added forms
   */
  private setupFormObserver() {
    this.formObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;

              // Check if it's a password field
              if (element.matches('input[type="password"]')) {
                this.processPasswordField(element as HTMLInputElement);
              }

              // Check descendants
              const passwordFields = element.querySelectorAll<HTMLInputElement>(
                'input[type="password"]'
              );
              passwordFields.forEach(field => this.processPasswordField(field));
            }
          });
        }
      }
    });

    this.formObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Process a password field: inject icon and setup listeners
   */
  private processPasswordField(passwordField: HTMLInputElement) {
    // Skip if already processed
    if (passwordField.dataset.flowpassProcessed === 'true') {
      return;
    }

    passwordField.dataset.flowpassProcessed = 'true';

    // Find associated username field
    const usernameField = this.findUsernameField(passwordField);

    // Inject FlowPass icon on focus
    passwordField.addEventListener('focus', () => {
      this.showFlowPassIcon(passwordField, usernameField);
    });

    // Track form for submission capture
    const form = passwordField.closest('form');
    if (form && !this.observedForms.has(form)) {
      this.observedForms.add(form);
      this.setupFormCaptureListeners(form, usernameField, passwordField);
    }
  }

  /**
   * Find the username field associated with a password field
   */
  private findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
    const form = passwordField.closest('form');

    if (form) {
      // Look for text/email fields before the password field
      const allInputs = Array.from(form.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
      ));

      // Find the closest text field before password field
      const passwordIndex = Array.from(form.querySelectorAll('input')).indexOf(passwordField);
      for (let i = passwordIndex - 1; i >= 0; i--) {
        const input = form.querySelectorAll('input')[i] as HTMLInputElement;
        if (
          input.type === 'text' ||
          input.type === 'email' ||
          input.type === 'tel' ||
          !input.type
        ) {
          return input;
        }
      }

      // Fallback: return first text/email field
      return allInputs[0] || null;
    }

    return null;
  }

  /**
   * Show FlowPass icon next to input field
   */
  private async showFlowPassIcon(
    passwordField: HTMLInputElement,
    usernameField: HTMLInputElement | null
  ) {
    // Remove existing icon if any
    this.removeIconForField(passwordField);

    // Check if bridge is available
    if (!window.flowPassBridge) {
      console.warn('[FlowPass] Bridge not available');
      return;
    }

    // Get matches for current hostname
    const hostname = window.location.hostname;
    const matches = await window.flowPassBridge.getMatches(hostname);

    if (matches.length === 0) {
      return; // No credentials available
    }

    // Create icon container
    const icon = this.createFlowPassIcon(matches, passwordField, usernameField);
    this.activeIcons.add(icon);

    // Position icon
    this.positionIcon(icon, passwordField);

    // Remove icon on blur (after a delay)
    const removeOnBlur = () => {
      setTimeout(() => {
        if (
          document.activeElement !== passwordField &&
          !icon.contains(document.activeElement as Node)
        ) {
          this.removeIcon(icon);
        }
      }, 200);
    };

    passwordField.addEventListener('blur', removeOnBlur, { once: true });
  }

  /**
   * Create FlowPass icon with dropdown
   */
  private createFlowPassIcon(
    matches: CredentialMatch[],
    passwordField: HTMLInputElement,
    usernameField: HTMLInputElement | null
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'flowpass-icon-container';
    container.style.cssText = `
      position: absolute;
      z-index: 999999;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      min-width: 200px;
    `;

    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 8px;
    `;
    header.textContent = '🔐 FlowPass';
    container.appendChild(header);

    // Create match list
    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

    matches.forEach(match => {
      const item = document.createElement('button');
      item.type = 'button';
      item.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 8px;
        border: none;
        background: transparent;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s;
      `;
      item.onmouseenter = () => {
        item.style.background = '#f3f4f6';
      };
      item.onmouseleave = () => {
        item.style.background = 'transparent';
      };

      const name = document.createElement('div');
      name.style.cssText = 'font-weight: 600; font-size: 13px; color: #111827;';
      name.textContent = match.name;

      const username = document.createElement('div');
      username.style.cssText = 'font-size: 12px; color: #6b7280;';
      username.textContent = match.username;

      item.appendChild(name);
      item.appendChild(username);

      item.onclick = async () => {
        await this.autofillCredentials(match.entryId, passwordField, usernameField);
        this.removeIcon(container);
      };

      list.appendChild(item);
    });

    container.appendChild(list);
    document.body.appendChild(container);

    return container;
  }

  /**
   * Position icon relative to input field
   */
  private positionIcon(icon: HTMLElement, field: HTMLInputElement) {
    const rect = field.getBoundingClientRect();
    icon.style.top = `${rect.bottom + window.scrollY + 4}px`;
    icon.style.left = `${rect.left + window.scrollX}px`;
  }

  /**
   * Remove icon from field
   */
  private removeIconForField(field: HTMLInputElement) {
    this.activeIcons.forEach(icon => {
      if (icon.dataset.fieldId === field.dataset.flowpassId) {
        this.removeIcon(icon);
      }
    });
  }

  /**
   * Remove icon
   */
  private removeIcon(icon: HTMLElement) {
    this.activeIcons.delete(icon);
    icon.remove();
  }

  /**
   * Autofill credentials into fields
   */
  private async autofillCredentials(
    entryId: string,
    passwordField: HTMLInputElement,
    usernameField: HTMLInputElement | null
  ) {
    if (!window.flowPassBridge) return;

    const credentials = await window.flowPassBridge.getCredentials(entryId);
    if (!credentials) return;

    // Fill username
    if (usernameField && credentials.username) {
      this.setInputValue(usernameField, credentials.username);
    }

    // Fill password
    if (credentials.password) {
      this.setInputValue(passwordField, credentials.password);
    }
  }

  /**
   * Set input value and trigger events
   */
  private setInputValue(input: HTMLInputElement, value: string) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    // Trigger events for React/Vue/Angular
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Setup form submission listeners for capturing credentials
   */
  private setupFormCaptureListeners(
    form: HTMLFormElement,
    usernameField: HTMLInputElement | null,
    passwordField: HTMLInputElement
  ) {
    form.addEventListener('submit', (e) => {
      this.captureFormSubmission(usernameField, passwordField);
    });
  }

  /**
   * Setup global form submission listeners
   */
  private setupFormSubmissionListeners() {
    // Listen for form submissions
    document.addEventListener('submit', (e) => {
      const form = e.target as HTMLFormElement;
      if (form.tagName === 'FORM') {
        const passwordField = form.querySelector<HTMLInputElement>('input[type="password"]');
        if (passwordField && passwordField.value) {
          const usernameField = this.findUsernameField(passwordField);
          this.captureFormSubmission(usernameField, passwordField);
        }
      }
    });

    // Monitor XMLHttpRequest for SPA logins
    this.monitorXHRRequests();

    // Monitor Fetch API for SPA logins
    this.monitorFetchRequests();
  }

  /**
   * Capture form submission
   */
  private captureFormSubmission(
    usernameField: HTMLInputElement | null,
    passwordField: HTMLInputElement
  ) {
    const username = usernameField?.value || '';
    const password = passwordField.value;

    if (password) {
      this.pendingCapture = { username, password };

      // Wait a bit to see if navigation happens
      setTimeout(() => {
        this.sendCaptureToBackground();
      }, 500);
    }
  }

  /**
   * Send captured credentials to background
   */
  private async sendCaptureToBackground() {
    if (!this.pendingCapture || !window.flowPassBridge) return;

    const { username, password } = this.pendingCapture;

    await window.flowPassBridge.captureLogin({
      host: window.location.hostname,
      url: window.location.href,
      username,
      password,
    });

    this.pendingCapture = null;
  }

  /**
   * Monitor XMLHttpRequest for login requests
   */
  private monitorXHRRequests() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...args: any[]) {
      (this as any)._flowpass_method = method;
      (this as any)._flowpass_url = url.toString();
      return originalOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if ((this as any)._flowpass_method === 'POST' && body) {
        try {
          const data = typeof body === 'string' ? JSON.parse(body) : body;
          if (data && typeof data === 'object') {
            // Look for password-like fields
            const keys = Object.keys(data);
            const hasPassword = keys.some(k =>
              k.toLowerCase().includes('password') ||
              k.toLowerCase().includes('pass')
            );
            const hasUsername = keys.some(k =>
              k.toLowerCase().includes('username') ||
              k.toLowerCase().includes('email') ||
              k.toLowerCase().includes('user')
            );

            if (hasPassword && hasUsername) {
              // Potential login request detected
              console.log('[FlowPass] Potential login request detected via XHR');
            }
          }
        } catch (e) {
          // Not JSON or failed to parse
        }
      }
      return originalSend.call(this, body);
    };
  }

  /**
   * Monitor Fetch API for login requests
   */
  private monitorFetchRequests() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const [url, options] = args;

      if (options?.method === 'POST' && options.body) {
        try {
          let data: any;
          if (typeof options.body === 'string') {
            data = JSON.parse(options.body);
          }

          if (data && typeof data === 'object') {
            const keys = Object.keys(data);
            const hasPassword = keys.some(k =>
              k.toLowerCase().includes('password') ||
              k.toLowerCase().includes('pass')
            );
            const hasUsername = keys.some(k =>
              k.toLowerCase().includes('username') ||
              k.toLowerCase().includes('email') ||
              k.toLowerCase().includes('user')
            );

            if (hasPassword && hasUsername) {
              console.log('[FlowPass] Potential login request detected via Fetch');
            }
          }
        } catch (e) {
          // Not JSON or failed to parse
        }
      }

      return originalFetch.apply(this, args);
    };
  }

  /**
   * Cleanup
   */
  public destroy() {
    this.formObserver?.disconnect();
    this.activeIcons.forEach(icon => icon.remove());
    this.activeIcons.clear();
    this.observedForms.clear();
  }
}

// Initialize content script
if (typeof window !== 'undefined') {
  new FlowPassContentScript();
}
