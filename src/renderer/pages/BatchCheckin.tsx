import { useState, useEffect } from 'react';
import { CheckCircle2, Play, Loader2, CheckSquare, Square, Clock, Award, Cpu } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import { AccountAvatar } from '../components/common/AccountAvatar';
import { useLanguage } from '../contexts/LanguageContext';
import { cn, formatNumber } from '../lib/utils';
import type { AccountView } from '../../shared/types';

interface CheckinProgress {
  accountId: number;
  status: 'pending' | 'checking' | 'success' | 'already' | 'failed';
  message?: string;
  creditsEarned?: number;
  deviceId?: string;
}

export function BatchCheckinPage() {
  const { t } = useLanguage();
  const { accounts, checkinBatch } = useAccounts();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<Map<number, CheckinProgress>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [summary, setSummary] = useState<{ success: number; already: number; failed: number; total: number } | null>(null);

  // Initialize selection with unchecked accounts
  useEffect(() => {
    const unchecked = accounts.filter(a => !a.isCheckedIn).map(a => a.id);
    setSelected(new Set(unchecked));
  }, [accounts.length]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(accounts.map(a => a.id)));
  const selectNone = () => setSelected(new Set());
  const selectUnchecked = () => setSelected(new Set(accounts.filter(a => !a.isCheckedIn).map(a => a.id)));

  const runBatchCheckin = async () => {
    if (selected.size === 0) return;
    setIsRunning(true);
    setSummary(null);

    const ids = Array.from(selected);
    const progressMap = new Map<number, CheckinProgress>();
    
    // Initialize all as pending
    ids.forEach(id => {
      progressMap.set(id, { accountId: id, status: 'pending' });
    });
    setProgress(new Map(progressMap));

    // The main process owns the global device queue and rate limit. Mark all
    // selected rows as running while it processes them sequentially.
    ids.forEach(id => {
      progressMap.set(id, { accountId: id, status: 'checking' });
    });
    setProgress(new Map(progressMap));

    const result = await checkinBatch(ids);
    if (result) {
      for (const item of result.results) {
        progressMap.set(item.accountId, {
          accountId: item.accountId,
          status: item.success
            ? (item.alreadyClaimed ? 'already' : 'success')
            : 'failed',
          message: item.message || (item.success ? t.batchCheckin.checkinSuccess : t.batchCheckin.checkinFailed),
          creditsEarned: item.creditsEarned,
          deviceId: item.deviceId,
        });
      }
      for (const item of result.errors) {
        progressMap.set(item.accountId, {
          accountId: item.accountId,
          status: 'failed',
          message: item.error || t.batchCheckin.checkinFailed,
        });
      }
      setSummary({
        total: result.total,
        success: result.success,
        already: result.alreadyClaimed,
        failed: result.failed,
      });
    } else {
      ids.forEach(id => {
        progressMap.set(id, { accountId: id, status: 'failed', message: t.batchCheckin.checkinFailed });
      });
      setSummary({ total: ids.length, success: 0, already: 0, failed: ids.length });
    }
    setProgress(new Map(progressMap));
    setIsRunning(false);
  };

  const getStatusIcon = (status: CheckinProgress['status']) => {
    switch (status) {
      case 'pending': return <Clock className="w-5 h-5 text-text-tertiary" />;
      case 'checking': return <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />;
      case 'success': return <CheckCircle2 className="w-5 h-5 text-green-400" />;
      case 'already': return <CheckCircle2 className="w-5 h-5 text-blue-400" />;
      case 'failed': return <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-xs">!</div>;
    }
  };

  const uncheckedCount = accounts.filter(a => !a.isCheckedIn).length;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
          <CheckSquare className="w-7 h-7 text-green-400" />
          {t.batchCheckin.title}
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          {t.batchCheckin.subtitle}
        </p>
      </div>

      {/* Selection info bar */}
      <div className="card mb-6 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">{t.common.select}:</span>
            <span className="text-lg font-semibold text-text-primary">{selected.size}</span>
            <span className="text-sm text-text-tertiary">/ {accounts.length} {t.nav.accounts.toLowerCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">{t.batchCheckin.notCheckedIn(0).split(':')[0]}:</span>
            <span className="text-lg font-semibold text-yellow-400">{uncheckedCount}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={selectAll} className="btn btn-ghost text-sm py-1.5">{t.common.selectAll}</button>
          <button onClick={selectUnchecked} className="btn btn-ghost text-sm py-1.5">{t.batchCheckin.selectUnchecked}</button>
          <button onClick={selectNone} className="btn btn-ghost text-sm py-1.5">{t.common.clear}</button>
          <button
            onClick={runBatchCheckin}
            disabled={isRunning || selected.size === 0}
            className="btn btn-success flex items-center gap-2"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isRunning ? t.batchCheckin.running : t.batchCheckin.startCheckin(selected.size)}
          </button>
        </div>
      </div>

      {/* Summary after completion */}
      {summary && (
        <div className="card mb-6 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/20">
          <div className="flex items-center gap-6">
            <Award className="w-10 h-10 text-green-400" />
            <div className="flex items-center gap-8">
              <div>
                <p className="text-2xl font-bold text-green-400">{summary.success}</p>
                <p className="text-xs text-text-secondary">{t.batchCheckin.newlyCheckedIn}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-400">{summary.already}</p>
                <p className="text-xs text-text-secondary">{t.batchCheckin.alreadyChecked}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{summary.failed}</p>
                <p className="text-xs text-text-secondary">{t.batchCheckin.failed}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{summary.total}</p>
                <p className="text-xs text-text-secondary">{t.batchCheckin.totalProcessed}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account list */}
      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <p className="text-text-secondary">{t.batchCheckin.noAccounts}</p>
            <p className="text-text-tertiary text-sm mt-1">{t.batchCheckin.addAccountsFirst}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account: AccountView) => {
              const prog = progress.get(account.id);
              const isSelected = selected.has(account.id);

              return (
                <div
                  key={account.id}
                  className={cn(
                    'p-4 rounded-xl glass-light transition-all duration-200 flex items-center gap-4',
                    isSelected ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-transparent',
                    prog?.status === 'success' && 'bg-green-500/10 border-green-500/20',
                    prog?.status === 'failed' && 'bg-red-500/10 border-red-500/20',
                  )}
                >
                  <button
                    onClick={() => !isRunning && toggleSelect(account.id)}
                    disabled={isRunning}
                    className="flex-shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-indigo-400" />
                    ) : (
                      <Square className="w-5 h-5 text-text-tertiary" />
                    )}
                  </button>

                  <AccountAvatar nickname={account.nickname} avatarUrl={account.avatarUrl} size="sm" />

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary truncate">{account.nickname}</p>
                    <p className="text-xs text-text-tertiary truncate">
                      {formatNumber(account.creditsBalance)} {t.accounts.credits}
                      {account.isCheckedIn && <span className="text-green-400 ml-2">✓ {t.accounts.checkedIn}</span>}
                    </p>
                  </div>

                  {prog && (
                    <div className="flex items-center gap-2">
                      {prog.deviceId && (
                        <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface/10 text-text-secondary border border-surface/10 shrink-0" title={`生效设备 ID: ${prog.deviceId}`}>
                          <Cpu className="w-3 h-3 text-indigo-400" />
                          <span>{prog.deviceId.length > 8 ? `${prog.deviceId.slice(0, 8)}...` : prog.deviceId}</span>
                        </span>
                      )}
                      {getStatusIcon(prog.status)}
                      {prog.message && (
                        <span className={cn(
                          'text-xs',
                          prog.status === 'failed' ? 'text-red-400' : 'text-text-secondary'
                        )}>
                          {prog.message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
