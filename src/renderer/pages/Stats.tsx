import { BarChart3, Coins, Users, CheckCircle, Clock } from 'lucide-react';
import { useAccounts } from '../hooks/useAccounts';
import { useLanguage } from '../contexts/LanguageContext';
import { formatNumber, getPayStatusType } from '../lib/utils';

export function StatsPage() {
  const { t } = useLanguage();
  const { accounts } = useAccounts();

  const totalCredits = accounts.reduce((sum, a) => sum + a.creditsBalance, 0);
  const checkedInCount = accounts.filter(a => a.isCheckedIn).length;
  const freeAccounts = accounts.filter(a => {
    const status = (a.payStatus || '').toLowerCase();
    return status.includes('free') || status === '0' || !a.payStatus;
  }).length;
  const proAccounts = accounts.length - freeAccounts;

  const payStatusLabels: Record<string, string> = {
    free: t.accounts.free,
    pro: t.accounts.pro,
    enterprise: t.accounts.enterprise,
    unknown: t.common.unknown,
  };

  const stats = [
    { label: t.stats.totalAccounts, value: accounts.length, icon: Users, color: 'from-indigo-500 to-purple-500', iconBg: 'bg-indigo-500/20' },
    { label: t.stats.totalCredits, value: formatNumber(totalCredits), icon: Coins, color: 'from-yellow-500 to-orange-500', iconBg: 'bg-yellow-500/20' },
    { label: t.stats.checkedInToday, value: `${checkedInCount}/${accounts.length}`, icon: CheckCircle, color: 'from-green-500 to-emerald-500', iconBg: 'bg-green-500/20' },
    { label: t.stats.proAccounts, value: proAccounts, icon: Clock, color: 'from-purple-500 to-pink-500', iconBg: 'bg-purple-500/20' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-purple-400" />
          {t.stats.title}
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          {t.stats.subtitle}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card card-hover">
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-xl ${stat.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-6 h-6`}
                    style={{ 
                      color: 'transparent',
                      WebkitTextFillColor: 'transparent',
                      backgroundImage: `linear-gradient(135deg, ${stat.color.includes('indigo') ? '#6366f1' : stat.color.includes('yellow') ? '#eab308' : stat.color.includes('green') ? '#22c55e' : '#a855f7'}, ${stat.color.includes('indigo') ? '#a855f7' : stat.color.includes('yellow') ? '#f97316' : stat.color.includes('green') ? '#10b981' : '#ec4899'})`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                    }}
                  />
                </div>
              </div>
              <p className="text-3xl font-bold text-text-primary mt-4">{stat.value}</p>
              <p className="text-sm text-text-secondary mt-1">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Account breakdown - scrolls independently; the page shell is
          overflow-hidden, so without this wrapper long content gets clipped */}
      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credits by account */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">{t.stats.creditsByAccount}</h3>
          {accounts.length === 0 ? (
            <p className="text-text-tertiary text-sm text-center py-8">{t.stats.noAccounts}</p>
          ) : (
            <div className="space-y-3">
              {[...accounts].sort((a, b) => b.creditsBalance - a.creditsBalance).map((account) => {
                const percentage = totalCredits > 0 ? (account.creditsBalance / totalCredits) * 100 : 0;
                return (
                  <div key={account.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-primary truncate max-w-[200px]">{account.nickname}</span>
                      <span className="text-text-secondary font-medium">{formatNumber(account.creditsBalance)}</span>
                    </div>
                    <div className="h-2 bg-surface/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Account status */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">{t.stats.accountStatus}</h3>
          {accounts.length === 0 ? (
            <p className="text-text-tertiary text-sm text-center py-8">{t.stats.noAccounts}</p>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const payStatusType = getPayStatusType(account.payStatus);
                const payLabel = payStatusLabels[payStatusType] || payStatusLabels.unknown;
                return (
                  <div key={account.id} className="flex items-center justify-between p-3 rounded-lg bg-surface/[0.03]">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${account.isCheckedIn ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <div>
                        <p className="text-sm font-medium text-text-primary">{account.nickname}</p>
                        <p className="text-xs text-text-tertiary">
                          {account.isCheckedIn ? t.accounts.checkedIn : t.accounts.notCheckedIn}
                        </p>
                      </div>
                    </div>
                    <span className="badge text-xs text-text-tertiary bg-surface/5">
                      {payLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
