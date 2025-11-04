/**
 * FlowPass React Hook
 */

import { useState, useCallback, useEffect } from 'react';
import type { VaultEntry, VaultStatus, FlowPassConfig, FlowPassState } from './types';

const DEFAULT_PROFILE_ID = 'default';

export function useFlowPass() {
  const [state, setState] = useState<FlowPassState>({
    status: 'locked',
    entries: [],
    config: null,
    isInitialized: false,
    hasVault: false,
    isConfigured: false,
    error: null,
  });

  const [isLoading, setIsLoading] = useState(false);

  // Initialize FlowPass
  const initialize = useCallback(async (profileId: string = DEFAULT_PROFILE_ID) => {
    if (!window.sylph?.flowpass) return;

    try {
      const result = await window.sylph.flowpass.initialize(profileId);
      if (result.success) {
        setState(prev => ({
          ...prev,
          isInitialized: true,
          hasVault: result.hasVault || false,
          isConfigured: result.isConfigured || false,
        }));

        // Load config if available
        const configResult = await window.sylph.flowpass.getConfig();
        if (configResult.success && configResult.config) {
          setState(prev => ({
            ...prev,
            config: configResult.config,
          }));
        }

        // Get status
        const statusResult = await window.sylph.flowpass.getStatus();
        if (statusResult.success && statusResult.status) {
          setState(prev => ({
            ...prev,
            status: statusResult.status!,
          }));
        }
      } else {
        setState(prev => ({
          ...prev,
          error: result.error || 'Failed to initialize',
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  // Setup vault with master password
  const setup = useCallback(async (masterPassword: string, profileId: string = DEFAULT_PROFILE_ID) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    try {
      const result = await window.sylph.flowpass.setup({ profileId, masterPassword });
      if (result.success) {
        setState(prev => ({
          ...prev,
          status: 'unlocked',
          isConfigured: true,
          hasVault: true,
          error: null,
        }));
        await loadEntries();
      } else {
        setState(prev => ({
          ...prev,
          error: result.error || 'Setup failed',
        }));
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, error: errorMsg }));
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Unlock vault
  const unlock = useCallback(async (masterPassword: string, profileId: string = DEFAULT_PROFILE_ID) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    setState(prev => ({ ...prev, status: 'unlocking' }));

    try {
      const result = await window.sylph.flowpass.unlock({ profileId, masterPassword });
      if (result.success) {
        setState(prev => ({
          ...prev,
          status: 'unlocked',
          error: null,
        }));
        await loadEntries();
      } else {
        setState(prev => ({
          ...prev,
          status: 'locked',
          error: result.error || 'Unlock failed',
        }));
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, status: 'locked', error: errorMsg }));
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Lock vault
  const lock = useCallback(async () => {
    if (!window.sylph?.flowpass) return;

    try {
      await window.sylph.flowpass.lock();
      setState(prev => ({
        ...prev,
        status: 'locked',
        entries: [],
        error: null,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Lock failed',
      }));
    }
  }, []);

  // Load entries
  const loadEntries = useCallback(async () => {
    if (!window.sylph?.flowpass) return;

    try {
      const result = await window.sylph.flowpass.getEntries();
      if (result.success && result.entries) {
        setState(prev => ({
          ...prev,
          entries: result.entries!,
          error: null,
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load entries',
      }));
    }
  }, []);

  // Save entry
  const saveEntry = useCallback(async (
    entry: VaultEntry,
    masterPassword: string,
    profileId: string = DEFAULT_PROFILE_ID
  ) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    try {
      const result = await window.sylph.flowpass.saveEntry({
        profileId,
        entry,
        masterPassword,
      });

      if (result.success) {
        await loadEntries();
      } else {
        setState(prev => ({
          ...prev,
          error: result.error || 'Failed to save entry',
        }));
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, error: errorMsg }));
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [loadEntries]);

  // Delete entry
  const deleteEntry = useCallback(async (
    entryId: string,
    masterPassword: string,
    profileId: string = DEFAULT_PROFILE_ID
  ) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    try {
      const result = await window.sylph.flowpass.deleteEntry({
        profileId,
        entryId,
        masterPassword,
      });

      if (result.success) {
        await loadEntries();
      } else {
        setState(prev => ({
          ...prev,
          error: result.error || 'Failed to delete entry',
        }));
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, error: errorMsg }));
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [loadEntries]);

  // Update config
  const updateConfig = useCallback(async (updates: Partial<FlowPassConfig>, profileId: string = DEFAULT_PROFILE_ID) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    try {
      const result = await window.sylph.flowpass.updateConfig({ profileId, updates });
      if (result.success) {
        setState(prev => ({
          ...prev,
          config: prev.config ? { ...prev.config, ...updates } : null,
        }));
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }, []);

  // Change master password
  const changeMasterPassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
    profileId: string = DEFAULT_PROFILE_ID
  ) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    try {
      const result = await window.sylph.flowpass.changeMasterPassword({
        profileId,
        currentPassword,
        newPassword,
      });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Export vault
  const exportVault = useCallback(async (profileId: string = DEFAULT_PROFILE_ID) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    try {
      const result = await window.sylph.flowpass.exportEncrypted(profileId);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }, []);

  // Import entries
  const importEntries = useCallback(async (
    entries: VaultEntry[],
    masterPassword: string,
    profileId: string = DEFAULT_PROFILE_ID
  ) => {
    if (!window.sylph?.flowpass) return { success: false, error: 'FlowPass not available' };

    setIsLoading(true);
    try {
      const result = await window.sylph.flowpass.importEntries({
        profileId,
        entries,
        masterPassword,
      });

      if (result.success) {
        await loadEntries();
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [loadEntries]);

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    isLoading,
    initialize,
    setup,
    unlock,
    lock,
    loadEntries,
    saveEntry,
    deleteEntry,
    updateConfig,
    changeMasterPassword,
    exportVault,
    importEntries,
    clearError,
  };
}
