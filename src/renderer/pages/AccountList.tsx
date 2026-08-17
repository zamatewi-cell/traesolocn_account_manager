import { useState } from 'react';
import { Plus, Users, Download, CheckSquare, RefreshCw, Coins, TrendingUp, PieChart, Zap } from 'lucide-react';
import { AccountCard } from '../components/common/AccountCard';
import { useAccounts } from '../hooks/useAccounts';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import { cn, formatNumber } from '../lib/utils';
import type { Account } from '../../shared/types';

interface AccountListPageProps {
  onOpenAddDialog?: () => void;
}

export function AccountListPage({ onOpenAddDialog }: AccountListPageProps) {
  const { t } = useLanguage();
  const [selectedForBatch, setSelectedForBatch] = useState<Set<number>>(new Set());
  const {
    accounts,
    loading,
    refreshing,
    checkingIn,
    switching,
    refreshAll,
    exportAccounts,
    deleteAccount,
    switchAccount,
    checkinSingle,
    checkinBatch,
  } = useAccounts();
  const { showToast } = useToast();

  const toggleSelect = (id: number) => {
    setSelectedForBatch(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedForBatch.size === accounts.length) {
      setSelectedForBatch(new Set());
    } else {
      setSelectedForBatch(new Set(accounts.map(a => a.id)));
    }
  };

  const handleBatchCheckin = async () => {
    if (selectedForBatch.size === 0) {
      showToast(t.toast.selectAtLeastOne, 'warning');
      return;
    }
    await checkinBatch(Array.from(selectedForBatch));
    setSelectedForBatch(new Set());
  };

  const totalCredits = accounts.reduce((sum, a) => sum + a.creditsBalance, 0);
  const checkedInCount = accounts.filter(a => a.isCheckedIn).length;
  const todayUsageTotal = accounts.reduce((sum, a) => sum + (a.todayUsage || 0), 0);
  const totalUsageAll = accounts.reduce((sum, a) => sum + (a.totalUsage || 0), 0);

  // Aggregate quota across all accounts for overall usage rate
  let aggTotal = 0;
  let aggUsed = 0;
  for (const a of accounts) {
    for (const pack of a.entitlementPacks || []) {
      const q = pack.entitlement_quota;
      if (!q || q.total_quota <= 0) continue;
      aggTotal += q.total_quota;
      aggUsed += q.used_quota || 0;
    }
  }
  const usageRate = aggTotal > 0 ? Math.round((aggUsed / aggTotal) * 100) : 0;

  const statCards = [
    { label: t.accounts.statTotalAccounts, value: String(accounts.length), icon: Users, accent: 'text-indigo-500', bar: 'bg-indigo-500' },
    { label: t.accounts.statTodayUsage, value: formatNumber(Math.round(todayUsageTotal * 100) / 100), icon: Zap, accent: 'text-red-500', bar: 'bg-red-500' },
    { label: t.accounts.statRemainingCredits, value: formatNumber(totalCredits), icon: Coins, accent: 'text-green-500', bar: 'bg-green-500' },
    { label: t.accounts.statUsageRate, value: `${usageRate}%`, icon: PieChart, accent: 'text-cyan-500', bar: 'bg-cyan-500', sub: aggTotal > 0 ? `${formatNumber(Math.round(aggUsed))} / ${formatNumber(Math.round(aggTotal))}` : undefined, percent: usageRate },
    { label: t.accounts.statTotalUsage, value: formatNumber(Math.round(totalUsageAll)), icon: TrendingUp, accent: 'text-purple-500', bar: 'bg-purple-500' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Stats cards row */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="card card-hover relative overflow-hidden !p-4 group">
                <div className={cn('absolute top-0 left-0 right-0 h-[3px] opacity-80 group-hover:opacity-100 transition-opacity', card.bar)} />
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1.5">
                  <Icon className={cn('w-3.5 h-3.5', card.accent)} />
                  {card.label}
                </div>
                <p className="text-2xl font-bold text-gradient">{card.value}</p>
                {card.sub && (
                  <p className="text-[10px] text-text-muted mt-0.5">{card.sub}</p>
                )}
                {card.percent !== undefined && (
                  <div className="h-1 mt-2 bg-surface/10 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all duration-500', card.bar)} style={{ width: `${Math.min(100, card.percent)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gradient flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl brand-gradient-bg flex items-center justify-center shadow-lg shadow-indigo-500/40">
              <Users className="w-5 h-5 text-white" />
            </span>
            {t.accounts.title}
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            {t.accounts.count(accounts.length)} · 
            <span className="text-yellow-500 ml-1">{t.accounts.totalCredits(totalCredits)}</span> ·
            <span className="text-green-500 ml-1">{t.accounts.checkedInToday(checkedInCount, accounts.length)}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refreshAll}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {t.common.refresh}
          </button>
          <button
            onClick={() => exportAccounts()}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {t.common.export}
          </button>
          <button
            onClick={onOpenAddDialog}
            className="btn btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t.accounts.addAccount}
          </button>
        </div>
      </div>

      {/* Batch actions bar */}
      {selectedForBatch.size > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-between animate-fade-in">
          <span className="text-sm text-text-primary">
            {t.accounts.selectedAccounts(selectedForBatch.size)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedForBatch(new Set())}
              className="btn btn-ghost text-sm py-1.5"
            >
              {t.common.clear}
            </button>
            <button
              onClick={handleBatchCheckin}
              className="btn btn-success text-sm py-1.5 flex items-center gap-2"
            >
              <CheckSquare className="w-4 h-4" />
              {t.accounts.checkinSelected}
            </button>
          </div>
        </div>
      )}

      {/* Account list */}
      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-10 h-10 border-3 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-text-secondary">{t.common.loading}</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center mb-4">
              <Users className="w-10 h-10 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">{t.accounts.noAccounts}</h3>
            <p className="text-text-secondary text-sm mb-4 max-w-xs">
              {t.accounts.addFirstAccount}
            </p>
            <button
              onClick={onOpenAddDialog}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t.accounts.addYourFirstAccount}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Select all checkbox */}
            <button
              onClick={selectAll}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface/5 transition-colors"
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                selectedForBatch.size === accounts.length
                  ? 'bg-indigo-500 border-indigo-500'
                  : selectedForBatch.size > 0
                  ? 'bg-indigo-500/50 border-indigo-500/50'
                  : 'border-surface/30'
              }`}>
                {selectedForBatch.size > 0 && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              {selectedForBatch.size === accounts.length ? t.accounts.deselectedAll : t.accounts.selectAllAccounts}
            </button>

            {accounts.map((account: Account, index: number) => (
              <div key={account.id} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                <button
                  onClick={() => toggleSelect(account.id)}
                  className={`mt-6 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selectedForBatch.has(account.id)
                      ? 'bg-indigo-500 border-indigo-500'
                      : 'border-surface/30 hover:border-surface/50'
                  }`}
                >
                  {selectedForBatch.has(account.id) && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1">
                  <AccountCard
                    account={account}
                    isCheckingIn={checkingIn.has(account.id)}
                    isSwitching={switching.has(account.id)}
                    onCheckin={() => checkinSingle(account.id)}
                    onRefresh={() => refreshAll()}
                    onSwitch={() => switchAccount(account.id)}
                    onDelete={() => deleteAccount(account.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
