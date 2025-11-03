import React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsApp from './SettingsApp';
import './settings.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Settings root container not found');
}

const root = createRoot(container);
root.render(<SettingsApp />);
