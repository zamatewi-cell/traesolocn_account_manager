import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, RefreshCw, LogIn, Trash2, Coins, MoreVertical, Check, XCircle, Clock, Zap, BarChart3, ReceiptText, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatNumber, formatDate, getPayStatusType, getPayStatusColor, getPayStatusBadgeClass, getPayStatusLabel, getQuotaDisplay, formatExpiration, getEntitlementTypeLabel } from '../../lib/utils';
import { AccountAvatar } from './AccountAvatar';
import { useLanguage } from '../../contexts/LanguageContext';
import type { Account, UsageRecord } from '../../../shared/types';

interface AccountCardProps {
  account: Account;
  isCheckingIn: boolean;
  onCheckin: () => void;
  onRefresh: () => void;
  onSwitch: () => void;
  onDelete: () => void;
}

type UsageRange = 'today' | '7d' | '30d';

const USAGE_PAGE_SIZE = 10;

function formatUsageTime(ts: number): string {
  if (!ts) return '-';
  // API returns seconds; normalize to ms
  const ms = ts < 10000000000 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getRangeStart(range: UsageRange): number {
  const now = new Date();
  if (range === 'today') {
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }
  const days = range === '7d' ? 7 : 30;
  return Math.floor((now.getTime() - days * 24 * 3600 * 1000) / 1000);
}

export function AccountCard({ account, isCheckingIn, onCheckin, onRefresh, onSwitch, onDelete }: AccountCardProps) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usageRange, setUsageRange] = useState<UsageRange>('7d');
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const payStatusType = getPayStatusType(account.payStatus);
  const payStatusColor = getPayStatusColor(payStatusType);
  const payStatusBadgeClass = getPayStatusBadgeClass(payStatusType);

  const entitlementPacks = account.entitlementPacks || [];

  const payStatusLabel = getPayStatusLabel(account.payStatus);

  const loadUsageRecords = useCallback(async (page: number, range: UsageRange) => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      const result = await window.electronAPI.usage.records(account.id, {
        startTime: getRangeStart(range),
        endTime: Math.floor(Date.now() / 1000),
        pageSize: USAGE_PAGE_SIZE,
        pageNum: page,
      });
      if (result.success && result.data) {
        setUsageRecords(result.data.records || []);
        setUsageTotal(result.data.total || 0);
      } else {
        setUsageError(result.error || '加载失败');
      }
    } catch (err) {
      setUsageError((err as Error).message || '加载失败');
    } finally {
      setUsageLoading(false);
    }
  }, [account.id]);

  const handleToggleDetails = () => {
    const next = !showDetails;
    setShowDetails(next);
    if (next && usageRecords.length === 0 && !usageError) {
      loadUsageRecords(1, usageRange);
    }
  };

  const handleRangeChange = (range: UsageRange) => {
    setUsageRange(range);
    setUsagePage(1);
    loadUsageRecords(1, range);
  };

  const handlePageChange = (page: number) => {
    setUsagePage(page);
    loadUsageRecords(page, usageRange);
  };

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const formattedDate = formatDate(account.lastCheckinAt);
  const lastRefreshed = formatDate(account.lastRefreshedAt);
  const totalPages = Math.max(1, Math.ceil(usageTotal / USAGE_PAGE_SIZE));

  const RANGE_TABS: Array<{ id: UsageRange; label: string }> = [
    { id: 'today', label: t.accounts.usageToday },
    { id: '7d', label: t.accounts.usage7Days },
    { id: '30d', label: t.accounts.usage30Days },
  ];

  return (
    <div className={cn(
      'card card-hover group relative',
      account.isActive && 'ring-2 ring-green-500/40 glow-success'
    )}>
      {/* Active indicator line */}
      {account.isActive && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 to-emerald-400 rounded-t-xl" />
      )}

      <div className="flex items-start gap-4">
        {/* Avatar */}
        <AccountAvatar
          nickname={account.nickname}
          avatarUrl={account.avatarUrl}
          size="lg"
          isActive={account.isActive}
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-text-primary truncate">{account.nickname}</h3>
            {account.isActive && (
              <span className="badge bg-green-500/15 text-green-500 text-[10px] flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {t.accounts.active}
              </span>
            )}
          </div>

          {account.email && (
            <p className="text-sm text-text-tertiary truncate mb-2">{account.email}</p>
          )}

          {/* Stats Row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-text-primary">
                {formatNumber(account.creditsBalance)}
              </span>
              <span className="text-xs text-text-tertiary">{t.accounts.credits}</span>
            </div>

            {account.checkinCredits !== null && account.checkinCredits !== undefined && account.checkinCredits > 0 && (
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-text-primary">
                  {formatNumber(account.checkinCredits)}
                </span>
                <span className="text-xs text-text-tertiary">{t.accounts.checkinCreditsLabel}</span>
              </div>
            )}

            <span className={cn('badge text-[10px]', payStatusBadgeClass, payStatusColor)}>
              {payStatusLabel}
            </span>

            <div className="flex items-center gap-1.5">
              {account.isCheckedIn ? (
                <>
                  <Check className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-green-500">{t.accounts.checkedIn}</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-yellow-500" />
                  <span className="text-xs text-yellow-500">{t.accounts.notCheckedIn}</span>
                </>
              )}
            </div>

            {/* Details toggle button */}
            <button
              onClick={handleToggleDetails}
              className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              {showDetails ? t.accounts.collapseDetails : t.accounts.usageDetailsTitle}
            </button>
          </div>

          {formattedDate && (
            <p className="text-xs text-text-muted mt-1.5">
              {t.accounts.lastCheckin(formattedDate)}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Primary action: Checkin */}
          {!account.isCheckedIn && (
            <button
              onClick={onCheckin}
              disabled={isCheckingIn}
              className="btn btn-success text-sm py-2 px-4 flex items-center gap-2"
            >
              {isCheckingIn ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {t.accounts.checkin}
            </button>
          )}

          {/* Switch button - prominent like the reference UI */}
          {!account.isActive && (
            <button
              onClick={onSwitch}
              className="btn btn-primary text-sm py-2 px-4 flex items-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              {t.accounts.switchToThis}
            </button>
          )}

          {account.isCheckedIn && (
            <button
              onClick={onRefresh}
              className="btn btn-ghost p-2"
              title={t.common.refresh}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {/* Menu button */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="btn btn-ghost p-2"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 glass rounded-lg shadow-xl z-20 py-1 animate-fade-in">
                  <button
                    onClick={() => { setShowMenu(false); onRefresh(); }}
                    className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface/10 flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t.accounts.refreshData}
                  </button>

                  {!account.isActive && (
                    <button
                      onClick={() => { setShowMenu(false); onSwitch(); }}
                      className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface/10 flex items-center gap-2"
                    >
                      <LogIn className="w-4 h-4" />
                      {t.accounts.switchToThis}
                    </button>
                  )}

                  <div className="border-t border-surface/8 my-1" />

                  <button
                    onClick={handleDelete}
                    className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    {confirmDelete ? t.accounts.clickToConfirm : t.accounts.deleteAccount}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Usage Details Section */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-surface/8 space-y-3 animate-fade-in">
          {/* Quota usage */}
          {entitlementPacks.length > 0 && (
            <>
              <h4 className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                {t.accounts.usageDetails}
              </h4>

              {entitlementPacks.map((pack, index) => {
                if (!pack.entitlement_quota) return null;

                const quota = getQuotaDisplay(pack.entitlement_quota);
                const typeLabel = getEntitlementTypeLabel(pack);
                const expiration = formatExpiration(pack.expire_time);
                const isExpired = pack.expire_time && pack.expire_time < Date.now();
                const quotaColor = quota.percent > 90 ? 'bg-red-500' : quota.percent > 70 ? 'bg-yellow-500' : 'bg-green-500';

                return (
                  <div key={pack.entitlement_pack_id || index} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-xs font-medium',
                          isExpired ? 'text-text-muted' : 'text-text-primary'
                        )}>
                          {typeLabel}
                        </span>
                        {pack.entitlement_pack_name && pack.entitlement_pack_name !== typeLabel && (
                          <span className="text-[10px] text-text-muted">
                            {pack.entitlement_pack_name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">
                          {formatNumber(quota.used)} / {formatNumber(quota.total)} {quota.unit}
                        </span>
                        {pack.expire_time ? (
                          <span className={cn(
                            'flex items-center gap-1 text-[10px]',
                            isExpired ? 'text-red-500' : 'text-text-muted'
                          )}>
                            <Clock className="w-3 h-3" />
                            {expiration}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-surface/8 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', quotaColor)}
                        style={{ width: `${quota.percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Usage records table */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h4 className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                <ReceiptText className="w-3.5 h-3.5" />
                {t.accounts.usageRecords}
                {usageTotal > 0 && (
                  <span className="text-text-muted font-normal">({t.accounts.usageTotalRecords(usageTotal)})</span>
                )}
              </h4>

              <div className="flex items-center gap-2">
                {/* Time range tabs */}
                <div className="flex rounded-lg overflow-hidden border border-surface/10">
                  {RANGE_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleRangeChange(tab.id)}
                      disabled={usageLoading}
                      className={cn(
                        'px-2.5 py-1 text-[11px] transition-colors',
                        usageRange === tab.id
                          ? 'bg-indigo-500 text-white'
                          : 'bg-surface/5 text-text-secondary hover:bg-surface/10'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => loadUsageRecords(usagePage, usageRange)}
                  disabled={usageLoading}
                  className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={cn('w-3 h-3', usageLoading && 'animate-spin')} />
                  {t.common.refresh}
                </button>
              </div>
            </div>

            {usageLoading ? (
              <div className="flex items-center justify-center py-6 text-text-tertiary">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs">{t.common.loading}</span>
              </div>
            ) : usageError ? (
              <div className="flex flex-col items-center justify-center py-4 gap-2">
                <span className="text-xs text-red-500">{t.accounts.usageLoadFailed}</span>
                <button
                  onClick={() => loadUsageRecords(usagePage, usageRange)}
                  className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                >
                  {t.accounts.usageRetry}
                </button>
              </div>
            ) : usageRecords.length === 0 ? (
              <div className="py-4 text-center">
                <ReceiptText className="w-5 h-5 mx-auto mb-1 text-text-muted" />
                <p className="text-xs text-text-muted">{t.accounts.usageEmpty}</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-surface/8">
                        <th className="text-left py-1.5 pr-2 font-medium whitespace-nowrap">{t.accounts.usageTime}</th>
                        <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">{t.accounts.usageRecord}</th>
                        <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">{t.accounts.usageModel}</th>
                        <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">{t.accounts.usageProduct}</th>
                        <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">{t.accounts.usageTokens}</th>
                        <th className="text-right py-1.5 pl-2 font-medium whitespace-nowrap">{t.accounts.usageCredits}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageRecords.map((record, i) => (
                        <tr key={record.session_id || i} className="border-b border-surface/5 hover:bg-surface/5 transition-colors">
                          <td className="py-1.5 pr-2 text-text-secondary whitespace-nowrap">
                            {formatUsageTime(record.session_start_time)}
                          </td>
                          <td className="py-1.5 px-2 text-text-secondary truncate max-w-[180px]" title={record.usage_desc}>
                            {record.usage_desc || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-text-primary truncate max-w-[120px]" title={record.model_name}>
                            {record.model_name || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-text-secondary truncate max-w-[80px]">
                            {record.product_name || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-right text-text-tertiary font-mono whitespace-nowrap">
                            {record.total_tokens > 0
                              ? `${formatNumber(record.prompt_tokens)} / ${formatNumber(record.completion_tokens)}`
                              : '-'}
                          </td>
                          <td className="py-1.5 pl-2 text-right text-text-primary font-mono whitespace-nowrap">
                            {record.credits_consumed > 0 ? `-${formatNumber(record.credits_consumed)}` : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[10px] text-text-muted">
                      {t.accounts.usagePageInfo(usagePage, totalPages)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handlePageChange(usagePage - 1)}
                        disabled={usagePage <= 1 || usageLoading}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-surface/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3 h-3" />
                        {t.accounts.usagePrevPage}
                      </button>
                      <button
                        onClick={() => handlePageChange(usagePage + 1)}
                        disabled={usagePage >= totalPages || usageLoading}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-surface/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {t.accounts.usageNextPage}
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {lastRefreshed && (
            <p className="text-[10px] text-text-muted pt-1">
              {t.accounts.usageUpdatedAt(lastRefreshed)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
