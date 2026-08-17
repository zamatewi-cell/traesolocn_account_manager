import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ToastProvider } from './contexts/ToastContext';
import { AccountsProvider } from './hooks/useAccounts';
import './index.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <AccountsProvider>
              <App />
            </AccountsProvider>
          </ToastProvider>
        </LanguageProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}
