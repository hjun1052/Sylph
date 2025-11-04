/**
 * FlowPass Settings Component
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useFlowPass } from './useFlowPass';
import type { VaultEntry } from './types';
import { v4 as uuidv4 } from 'uuid';

type View = 'setup' | 'unlock' | 'vault' | 'entry-editor';

export function FlowPassSettings() {
  const flowPass = useFlowPass();
  const [currentView, setCurrentView] = useState<View>('unlock');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Initialize on mount
  useEffect(() => {
    flowPass.initialize();
  }, []);

  // Update view based on state
  useEffect(() => {
    if (!flowPass.isInitialized) return;

    if (!flowPass.isConfigured || !flowPass.hasVault) {
      setCurrentView('setup');
    } else if (flowPass.status === 'locked') {
      setCurrentView('unlock');
    } else if (flowPass.status === 'unlocked') {
      setCurrentView('vault');
    }
  }, [flowPass.isInitialized, flowPass.isConfigured, flowPass.hasVault, flowPass.status]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (!searchQuery) return flowPass.entries;

    const query = searchQuery.toLowerCase();
    return flowPass.entries.filter(entry =>
      entry.name.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query) ||
      entry.urls.some(url => url.toLowerCase().includes(query))
    );
  }, [flowPass.entries, searchQuery]);

  // Handle setup
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (masterPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    if (masterPassword.length < 8) {
      alert('Password must be at least 8 characters');
      return;
    }

    const result = await flowPass.setup(masterPassword);
    if (result.success) {
      setMasterPassword('');
      setConfirmPassword('');
    } else {
      alert(result.error || 'Setup failed');
    }
  };

  // Handle unlock
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await flowPass.unlock(masterPassword);
    if (result.success) {
      setMasterPassword('');
    } else {
      alert(result.error || 'Unlock failed');
    }
  };

  // Handle lock
  const handleLock = () => {
    flowPass.lock();
    setSearchQuery('');
    setSelectedEntry(null);
  };

  // Handle new entry
  const handleNewEntry = () => {
    const newEntry: VaultEntry = {
      id: uuidv4(),
      name: '',
      urls: [''],
      username: '',
      password: '',
      notes: '',
      customFields: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    setSelectedEntry(newEntry);
    setCurrentView('entry-editor');
  };

  // Handle edit entry
  const handleEditEntry = (entry: VaultEntry) => {
    setSelectedEntry(entry);
    setCurrentView('entry-editor');
  };

  // Handle save entry
  const handleSaveEntry = async (entry: VaultEntry) => {
    const password = prompt('Enter your master password to save:');
    if (!password) return;

    const result = await flowPass.saveEntry(entry, password);
    if (result.success) {
      setSelectedEntry(null);
      setCurrentView('vault');
    } else {
      alert(result.error || 'Failed to save entry');
    }
  };

  // Handle delete entry
  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    const password = prompt('Enter your master password to delete:');
    if (!password) return;

    const result = await flowPass.deleteEntry(entryId, password);
    if (result.success) {
      setSelectedEntry(null);
    } else {
      alert(result.error || 'Failed to delete entry');
    }
  };

  // Render setup view
  if (currentView === 'setup') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Set Up FlowPass</h2>
          <p style={styles.description}>
            Create a master password to encrypt your credentials. Make sure it's strong and memorable.
          </p>
          <form onSubmit={handleSetup} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Master Password</label>
              <input
                type="password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                style={styles.input}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={styles.input}
                placeholder="Confirm your password"
                required
              />
            </div>
            <button type="submit" style={styles.primaryButton} disabled={flowPass.isLoading}>
              {flowPass.isLoading ? 'Setting up...' : 'Set Up FlowPass'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render unlock view
  if (currentView === 'unlock') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Unlock FlowPass</h2>
          <p style={styles.description}>
            Enter your master password to access your credentials.
          </p>
          <form onSubmit={handleUnlock} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Master Password</label>
              <input
                type="password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                style={styles.input}
                placeholder="Enter master password"
                required
                autoFocus
              />
            </div>
            <button type="submit" style={styles.primaryButton} disabled={flowPass.isLoading}>
              {flowPass.isLoading ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render entry editor
  if (currentView === 'entry-editor' && selectedEntry) {
    return (
      <EntryEditor
        entry={selectedEntry}
        onSave={handleSaveEntry}
        onCancel={() => {
          setSelectedEntry(null);
          setCurrentView('vault');
        }}
        onDelete={handleDeleteEntry}
      />
    );
  }

  // Render vault view
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>FlowPass</h2>
        <div style={styles.headerActions}>
          <button onClick={handleNewEntry} style={styles.primaryButton}>
            + New Entry
          </button>
          <button onClick={handleLock} style={styles.secondaryButton}>
            Lock Vault
          </button>
        </div>
      </div>

      <div style={styles.searchBar}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search entries..."
          style={styles.searchInput}
        />
      </div>

      <div style={styles.entryList}>
        {filteredEntries.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No entries found.</p>
            <button onClick={handleNewEntry} style={styles.primaryButton}>
              Create Your First Entry
            </button>
          </div>
        ) : (
          filteredEntries.map(entry => (
            <div
              key={entry.id}
              style={styles.entryCard}
              onClick={() => handleEditEntry(entry)}
            >
              <div style={styles.entryHeader}>
                <h3 style={styles.entryName}>{entry.name || 'Untitled'}</h3>
                <span style={styles.entryUsername}>{entry.username}</span>
              </div>
              <div style={styles.entryUrls}>
                {entry.urls.filter(url => url).map((url, i) => (
                  <span key={i} style={styles.entryUrl}>{url}</span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {flowPass.config && (
        <div style={styles.footer}>
          <p style={styles.footerText}>
            Auto-lock: {flowPass.config.autoLockMinutes} minutes
          </p>
          <p style={styles.footerText}>
            Entries: {flowPass.entries.length}
          </p>
        </div>
      )}
    </div>
  );
}

// Entry Editor Component
function EntryEditor({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: VaultEntry;
  onSave: (entry: VaultEntry) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}) {
  const [editedEntry, setEditedEntry] = useState<VaultEntry>(entry);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editedEntry.name) {
      alert('Entry name is required');
      return;
    }
    onSave(editedEntry);
  };

  const handleAddUrl = () => {
    setEditedEntry(prev => ({
      ...prev,
      urls: [...prev.urls, ''],
    }));
  };

  const handleRemoveUrl = (index: number) => {
    setEditedEntry(prev => ({
      ...prev,
      urls: prev.urls.filter((_, i) => i !== index),
    }));
  };

  const handleUrlChange = (index: number, value: string) => {
    setEditedEntry(prev => ({
      ...prev,
      urls: prev.urls.map((url, i) => (i === index ? value : url)),
    }));
  };

  const generatePassword = () => {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    let password = '';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      password += charset[array[i] % charset.length];
    }
    setEditedEntry(prev => ({ ...prev, password }));
  };

  return (
    <div style={styles.container}>
      <div style={styles.editorHeader}>
        <h2 style={styles.title}>{entry.id ? 'Edit Entry' : 'New Entry'}</h2>
        <div style={styles.headerActions}>
          <button onClick={onCancel} style={styles.secondaryButton}>
            Cancel
          </button>
          {entry.id && (
            <button onClick={() => onDelete(entry.id)} style={styles.dangerButton}>
              Delete
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={styles.editorForm}>
        <div style={styles.field}>
          <label style={styles.label}>Name *</label>
          <input
            type="text"
            value={editedEntry.name}
            onChange={(e) => setEditedEntry({ ...editedEntry, name: e.target.value })}
            style={styles.input}
            placeholder="e.g., GitHub Account"
            required
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Username</label>
          <input
            type="text"
            value={editedEntry.username}
            onChange={(e) => setEditedEntry({ ...editedEntry, username: e.target.value })}
            style={styles.input}
            placeholder="Username or email"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Password</label>
          <div style={styles.passwordField}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={editedEntry.password}
              onChange={(e) => setEditedEntry({ ...editedEntry, password: e.target.value })}
              style={{...styles.input, flex: 1}}
              placeholder="Password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={styles.iconButton}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
            <button
              type="button"
              onClick={generatePassword}
              style={styles.iconButton}
              title="Generate password"
            >
              🔄
            </button>
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>URLs</label>
          {editedEntry.urls.map((url, index) => (
            <div key={index} style={styles.urlField}>
              <input
                type="url"
                value={url}
                onChange={(e) => handleUrlChange(index, e.target.value)}
                style={{...styles.input, flex: 1}}
                placeholder="https://example.com"
              />
              {editedEntry.urls.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveUrl(index)}
                  style={styles.iconButton}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={handleAddUrl} style={styles.secondaryButton}>
            + Add URL
          </button>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Notes</label>
          <textarea
            value={editedEntry.notes}
            onChange={(e) => setEditedEntry({ ...editedEntry, notes: e.target.value })}
            style={styles.textarea}
            placeholder="Additional notes..."
            rows={4}
          />
        </div>

        <button type="submit" style={styles.primaryButton}>
          Save Entry
        </button>
      </form>
    </div>
  );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '20px',
    maxWidth: '800px',
    margin: '0 auto',
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: '8px',
    padding: '32px',
    maxWidth: '400px',
    margin: '100px auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#ffffff',
    margin: 0,
  },
  description: {
    color: '#a0a0a0',
    marginBottom: '24px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#e0e0e0',
  },
  input: {
    padding: '10px 12px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #404040',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
  },
  textarea: {
    padding: '10px 12px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #404040',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  primaryButton: {
    padding: '10px 16px',
    backgroundColor: 'var(--color-green-400)',
    color: '#000000',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '10px 16px',
    backgroundColor: '#2a2a2a',
    color: '#ffffff',
    border: '1px solid #404040',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  dangerButton: {
    padding: '10px 16px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
  },
  searchBar: {
    marginBottom: '16px',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #404040',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
  },
  entryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  entryCard: {
    padding: '16px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #404040',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  entryHeader: {
    marginBottom: '8px',
  },
  entryName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#ffffff',
    margin: '0 0 4px 0',
  },
  entryUsername: {
    fontSize: '14px',
    color: '#a0a0a0',
  },
  entryUrls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  entryUrl: {
    fontSize: '12px',
    color: '#60a5fa',
    backgroundColor: '#1e3a5f',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 16px',
    color: '#a0a0a0',
  },
  footer: {
    marginTop: '24px',
    paddingTop: '16px',
    borderTop: '1px solid #404040',
    display: 'flex',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: '12px',
    color: '#a0a0a0',
    margin: 0,
  },
  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  editorForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  passwordField: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  urlField: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '8px',
  },
  iconButton: {
    padding: '8px 12px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #404040',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
  },
};
