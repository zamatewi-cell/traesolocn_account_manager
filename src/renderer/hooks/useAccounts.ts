import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { Account } from '../../shared/types';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';

function useAccountsState() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingIn, setCheckingIn] = useState<Set<number>>(new Set());
  const [switching, setSwitching] = useState<Set<number>>(new Set());
  const [batchCheckingIn, setBatchCheckingIn] = useState(false);
  const { showToast } = useToast();
  const { t } = useLanguage();

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.accounts.list();
      if (result.success && result.data) {
        setAccounts(result.data);
      } else {
        showToast(result.error || t.toast.failedLoadAccounts, 'error');
      }
    } catch (err) {
      showToast(t.toast.failedLoadAccounts, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const refreshAccount = useCallback(async (id: number) => {
    try {
      const result = await window.electronAPI.accounts.refresh(id);
      if (result.success && result.data) {
        setAccounts(prev => prev.map(a => a.id === id ? result.data! : a));
      }
    } catch (err) {
      console.error('Failed to refresh account:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      setRefreshing(true);
      const result = await window.electronAPI.accounts.refreshAll();
      if (result.success && result.data) {
        setAccounts(result.data);
        showToast(t.toast.allAccountsRefreshed, 'success');
      } else {
        showToast(result.error || t.toast.failedRefresh, 'error');
      }
    } catch (err) {
      showToast(t.toast.failedRefresh, 'error');
    } finally {
      setRefreshing(false);
    }
  }, [showToast, t]);

  const addByToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.accounts.addByToken(token);
      if (result.success && result.data) {
        setAccounts(prev => {
          // Replace if exists (same user ID), otherwise add
          const existing = prev.findIndex(a => a.userId === result.data!.userId);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = result.data!;
            return updated;
          }
          return [result.data!, ...prev];
        });
        showToast(t.toast.accountAdded(result.data.nickname), 'success');
        return true;
      } else {
        showToast(result.error || t.toast.failedAddAccount, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.failedAddAccount, 'error');
      return false;
    }
  }, [showToast, t]);

  const addByOAuth = useCallback(async (): Promise<boolean> => {
    try {
      showToast(t.toast.openingLogin, 'info');
      const result = await window.electronAPI.accounts.addByOAuth();
      if (result.success && result.data) {
        setAccounts(prev => {
          const existing = prev.findIndex(a => a.userId === result.data!.userId);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = result.data!;
            return updated;
          }
          return [result.data!, ...prev];
        });
        showToast(t.toast.loggedInAs(result.data.nickname), 'success');
        return true;
      } else {
        showToast(result.error || t.toast.loginFailed, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.loginFailed + ': ' + (err as Error).message, 'error');
      return false;
    }
  }, [showToast, t]);

  const addFromLocal = useCallback(async (localInfo?: any): Promise<boolean> => {
    try {
      const result = await window.electronAPI.accounts.addFromLocal(localInfo);
      if (result.success && result.data) {
        setAccounts(prev => {
          const existing = prev.findIndex(a => a.userId === result.data!.userId);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = result.data!;
            return updated;
          }
          return [result.data!, ...prev];
        });
        showToast(t.toast.importedLocal(result.data.nickname), 'success');
        return true;
      } else {
        showToast(result.error || t.toast.failedImportLocal, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.failedImportLocal, 'error');
      return false;
    }
  }, [showToast, t]);

  const importFromJson = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI.accounts.importFromJson();
      if (result.success && result.data) {
        await loadAccounts();
        showToast(t.toast.importedAccounts(result.data.length), 'success');
        return true;
      } else {
        showToast(result.error || t.toast.importFailed, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.importFailed, 'error');
      return false;
    }
  }, [loadAccounts, showToast, t]);

  const exportAccounts = useCallback(async (ids?: number[]) => {
    try {
      const result = await window.electronAPI.accounts.export(ids);
      if (result.success) {
        showToast(t.toast.exportedSuccess, 'success');
      } else if (result.error !== 'Export cancelled') {
        showToast(result.error || t.toast.exportFailed, 'error');
      }
    } catch (err) {
      showToast(t.toast.exportFailed, 'error');
    }
  }, [showToast, t]);

  const deleteAccount = useCallback(async (id: number) => {
    try {
      const result = await window.electronAPI.accounts.delete(id);
      if (result.success) {
        setAccounts(prev => prev.filter(a => a.id !== id));
        showToast(t.toast.accountDeleted, 'success');
      } else {
        showToast(result.error || t.toast.failedDelete, 'error');
      }
    } catch (err) {
      showToast(t.toast.failedDelete, 'error');
    }
  }, [showToast, t]);

  const switchAccount = useCallback(async (id: number): Promise<boolean> => {
    // Immediate UI feedback: the whole flow (process detection, close Trae,
    // write storage, restart) can take 5-15s, so mark the card right away.
    setSwitching(prev => new Set(prev).add(id));
    try {
      // Read app settings to decide whether to auto-manage Trae
      let autoCloseTrae = false;
      let autoRestartTrae = false;
      let traeExePath = '';
      try {
        const settingsResult = await window.electronAPI.app.getSettings();
        if (settingsResult.success && settingsResult.data) {
          autoCloseTrae = settingsResult.data.autoCloseTrae;
          autoRestartTrae = settingsResult.data.autoRestartTrae;
          traeExePath = settingsResult.data.traeExePath;
        }
      } catch {
        // ignore, fall back to manual close
      }

      // If auto-close is disabled, check whether Trae is running and warn
      if (!autoCloseTrae) {
        const traeworkCheck = await window.electronAPI.storage.isTraeworkRunning();
        if (traeworkCheck.success && traeworkCheck.data?.running) {
          showToast(t.toast.closeTraeFirst, 'warning');
          return false;
        }
      }

      const result = await window.electronAPI.accounts.switch(id, {
        autoCloseTrae,
        autoRestartTrae,
        traeExePath: traeExePath || undefined,
      });
      if (result.success) {
        // Update active status
        setAccounts(prev => prev.map(a => ({
          ...a,
          isActive: a.id === id,
        })));
        if (autoRestartTrae && (result.data as any)?.traeRestarted === false) {
          showToast(t.toast.traeRestartFailed, 'warning');
        } else {
          showToast(t.toast.switchedTo(result.data?.nickname || ''), 'success');
        }
        return true;
      } else {
        showToast(result.error || t.toast.failedSwitch, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.failedSwitch + ': ' + (err as Error).message, 'error');
      return false;
    } finally {
      setSwitching(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [showToast, t]);

  const checkinSingle = useCallback(async (id: number): Promise<boolean> => {
    setCheckingIn(prev => new Set(prev).add(id));
    try {
      const result = await window.electronAPI.checkin.single(id);
      if (result.success && result.data) {
        await refreshAccount(id);
        if (result.data.alreadyClaimed) {
          showToast(t.toast.alreadyCheckedIn, 'info');
        } else {
          showToast(t.toast.checkedIn(result.data.creditsEarned), 'success');
        }
        return true;
      } else {
        showToast(result.error || t.toast.checkinFailed, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.checkinFailed, 'error');
      return false;
    } finally {
      setCheckingIn(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [refreshAccount, showToast, t]);

  const checkinBatch = useCallback(async (ids: number[]): Promise<boolean> => {
    setBatchCheckingIn(true);
    try {
      const result = await window.electronAPI.checkin.batch(ids);
      if (result.success && result.data) {
        await loadAccounts();
        const { success, alreadyClaimed, failed, total } = result.data;
        showToast(
          t.toast.batchComplete(success, alreadyClaimed, failed, total),
          failed > 0 ? 'warning' : 'success'
        );
        return failed === 0;
      } else {
        showToast(result.error || t.toast.batchFailed, 'error');
        return false;
      }
    } catch (err) {
      showToast(t.toast.batchFailed, 'error');
      return false;
    } finally {
      setBatchCheckingIn(false);
    }
  }, [loadAccounts, showToast, t]);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  return {
    accounts,
    loading,
    refreshing,
    checkingIn,
    switching,
    batchCheckingIn,
    loadAccounts,
    refreshAccount,
    refreshAll,
    addByToken,
    addByOAuth,
    addFromLocal,
    importFromJson,
    exportAccounts,
    deleteAccount,
    switchAccount,
    checkinSingle,
    checkinBatch,
  };
}

// Shared context so every page sees the same account state
// (avoids each page having its own isolated copy).
type AccountsState = ReturnType<typeof useAccountsState>;

const AccountsContext = createContext<AccountsState | null>(null);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const state = useAccountsState();
  return React.createElement(AccountsContext.Provider, { value: state }, children);
}

export function useAccounts(): AccountsState {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error('useAccounts must be used within AccountsProvider');
  return ctx;
}
