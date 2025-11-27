/**
 * FlowPass Content Script Injector
 * Injects the content script into webviews and sets up the bridge
 */

import type { WebviewTag } from 'electron';

export function injectFlowPassContentScript(webview: WebviewTag) {
  // Wait for webview to finish loading
  const handleDOMReady = () => {
    // Inject the bridge first
    webview.executeJavaScript(`
      (function() {
        // Skip if bridge already exists
        if (window.flowPassBridge) return;

        // Create FlowPass bridge for communication with main process
        window.flowPassBridge = {
          getMatches: async function(hostname) {
            try {
              const result = await window.sylph?.flowpass?.getMatches(hostname);
              if (result?.success && result.matches) {
                return result.matches;
              }
              return [];
            } catch (error) {
              console.error('[FlowPass] getMatches error:', error);
              return [];
            }
          },

          getCredentials: async function(entryId) {
            try {
              const result = await window.sylph?.flowpass?.getCredentials(entryId);
              if (result?.success && result.credentials) {
                return result.credentials;
              }
              return null;
            } catch (error) {
              console.error('[FlowPass] getCredentials error:', error);
              return null;
            }
          },

          captureLogin: async function(data) {
            try {
              await window.sylph?.flowpass?.captureLogin(data);
            } catch (error) {
              console.error('[FlowPass] captureLogin error:', error);
            }
          }
        };

        console.log('[FlowPass] Bridge injected successfully');
      })();
    `, false).catch((error: Error) => {
      console.error('[FlowPass] Failed to inject bridge:', error);
    });

    // Then inject the content script
    const contentScript = getContentScriptCode();

    webview.executeJavaScript(contentScript, false).catch((error: Error) => {
      console.error('[FlowPass] Failed to inject content script:', error);
    });
  };

  // Listen for DOM ready
  webview.addEventListener('dom-ready', handleDOMReady);

  // Return cleanup function
  return () => {
    webview.removeEventListener('dom-ready', handleDOMReady);
  };
}

/**
 * Get the content script code as a string
 * In production, this would be bundled separately
 */
function getContentScriptCode(): string {
  // For now, we'll inline a simplified version
  // In production, you'd load the compiled content-script.ts
  return `
(function() {
  'use strict';

  console.log('[FlowPass] Content script loaded');

  class FlowPassContentScript {
    constructor() {
      this.activeIcons = new Set();
      this.observedForms = new Set();
      this.pendingCapture = null;
      this.initialize();
    }

    initialize() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.start());
      } else {
        this.start();
      }
    }

    start() {
      this.scanForForms();
      this.setupFormObserver();
      this.setupFormSubmissionListeners();
    }

    scanForForms() {
      const passwordFields = document.querySelectorAll('input[type="password"]');
      passwordFields.forEach(field => this.processPasswordField(field));
    }

    setupFormObserver() {
      this.formObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                if (element.matches && element.matches('input[type="password"]')) {
                  this.processPasswordField(element);
                }
                const passwordFields = element.querySelectorAll ?
                  element.querySelectorAll('input[type="password"]') : [];
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

    processPasswordField(passwordField) {
      if (passwordField.dataset.flowpassProcessed === 'true') return;
      passwordField.dataset.flowpassProcessed = 'true';

      const usernameField = this.findUsernameField(passwordField);

      passwordField.addEventListener('focus', () => {
        this.showFlowPassIcon(passwordField, usernameField);
      });

      const form = passwordField.closest('form');
      if (form && !this.observedForms.has(form)) {
        this.observedForms.add(form);
        this.setupFormCaptureListeners(form, usernameField, passwordField);
      }
    }

    findUsernameField(passwordField) {
      const form = passwordField.closest('form');
      if (!form) return null;

      const allInputs = form.querySelectorAll('input');
      const passwordIndex = Array.from(allInputs).indexOf(passwordField);

      for (let i = passwordIndex - 1; i >= 0; i--) {
        const input = allInputs[i];
        if (input.type === 'text' || input.type === 'email' || input.type === 'tel' || !input.type) {
          return input;
        }
      }

      return null;
    }

    async showFlowPassIcon(passwordField, usernameField) {
      this.removeIconForField(passwordField);

      if (!window.flowPassBridge) {
        console.warn('[FlowPass] Bridge not available');
        return;
      }

      const hostname = window.location.hostname;
      const matches = await window.flowPassBridge.getMatches(hostname);

      if (matches.length === 0) return;

      const icon = this.createFlowPassIcon(matches, passwordField, usernameField);
      this.activeIcons.add(icon);
      this.positionIcon(icon, passwordField);

      const removeOnBlur = () => {
        setTimeout(() => {
          if (document.activeElement !== passwordField &&
              !icon.contains(document.activeElement)) {
            this.removeIcon(icon);
          }
        }, 200);
      };

      passwordField.addEventListener('blur', removeOnBlur, { once: true });
    }

    createFlowPassIcon(matches, passwordField, usernameField) {
      const container = document.createElement('div');
      container.className = 'flowpass-icon-container';
      container.style.cssText = 'position: absolute; z-index: 999999; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); padding: 8px; min-width: 200px;';

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px;';
      header.textContent = '🔐 FlowPass';
      container.appendChild(header);

      const list = document.createElement('div');
      list.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';

      matches.forEach(match => {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; padding: 8px; border: none; background: transparent; border-radius: 4px; cursor: pointer; text-align: left; transition: background 0.2s;';

        item.onmouseenter = () => { item.style.background = '#f3f4f6'; };
        item.onmouseleave = () => { item.style.background = 'transparent'; };

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

    positionIcon(icon, field) {
      const rect = field.getBoundingClientRect();
      icon.style.top = rect.bottom + window.scrollY + 4 + 'px';
      icon.style.left = rect.left + window.scrollX + 'px';
    }

    removeIconForField(field) {
      this.activeIcons.forEach(icon => {
        if (icon.dataset.fieldId === field.dataset.flowpassId) {
          this.removeIcon(icon);
        }
      });
    }

    removeIcon(icon) {
      this.activeIcons.delete(icon);
      icon.remove();
    }

    async autofillCredentials(entryId, passwordField, usernameField) {
      if (!window.flowPassBridge) return;

      const credentials = await window.flowPassBridge.getCredentials(entryId);
      if (!credentials) return;

      if (usernameField && credentials.username) {
        this.setInputValue(usernameField, credentials.username);
      }

      if (credentials.password) {
        this.setInputValue(passwordField, credentials.password);
      }
    }

    setInputValue(input, value) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, value);
      } else {
        input.value = value;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setupFormCaptureListeners(form, usernameField, passwordField) {
      form.addEventListener('submit', () => {
        this.captureFormSubmission(usernameField, passwordField);
      });
    }

    setupFormSubmissionListeners() {
      document.addEventListener('submit', (e) => {
        const form = e.target;
        if (form.tagName === 'FORM') {
          const passwordField = form.querySelector('input[type="password"]');
          if (passwordField && passwordField.value) {
            const usernameField = this.findUsernameField(passwordField);
            this.captureFormSubmission(usernameField, passwordField);
          }
        }
      });
    }

    captureFormSubmission(usernameField, passwordField) {
      const username = usernameField?.value || '';
      const password = passwordField.value;

      if (password) {
        this.pendingCapture = { username, password };
        setTimeout(() => {
          this.sendCaptureToBackground();
        }, 500);
      }
    }

    async sendCaptureToBackground() {
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
  }

  // Initialize
  new FlowPassContentScript();
})();
  `;
}
