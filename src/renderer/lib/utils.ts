import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { EntitlementPack } from '../../shared/types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Generate a color from a string (for avatar backgrounds).
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
    '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#8b5cf6',
  ];
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Get initials from a name/email.
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  
  const parts = name.trim().split(/[\s@]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Format a number with commas.
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '0';
  return num.toLocaleString();
}

/**
 * Format a date string to a readable format.
 * Returns null if no date provided.
 */
export function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * Pay status type
 */
export type PayStatusType = 'free' | 'pro' | 'enterprise' | 'unknown';

/**
 * Get pay status type from status string.
 */
export function getPayStatusType(status: string | null): PayStatusType {
  if (!status) return 'unknown';
  
  const lower = status.toLowerCase();
  if (lower.includes('free') || lower === '0' || lower.includes('normal')) {
    return 'free';
  }
  if (lower.includes('pro') || lower.includes('paid') || lower.includes('vip') || lower.includes('premium')) {
    return 'pro';
  }
  if (lower.includes('enterprise') || lower.includes('ent') || lower.includes('team')) {
    return 'enterprise';
  }
  return 'unknown';
}

/**
 * Get pay status label
 */
export function getPayStatusLabel(status: string | null): string {
  const type = getPayStatusType(status);
  switch (type) {
    case 'free':
      return '免费版';
    case 'pro':
      return 'Pro 会员';
    case 'enterprise':
      return '企业版';
    default:
      return status || '未知';
  }
}

/**
 * Get pay status color class.
 */
export function getPayStatusColor(status: PayStatusType): string {
  switch (status) {
    case 'pro':
      return 'text-purple-400';
    case 'enterprise':
      return 'text-blue-400';
    case 'free':
      return 'text-text-secondary';
    default:
      return 'text-text-tertiary';
  }
}

/**
 * Get pay status badge background class
 */
export function getPayStatusBadgeClass(status: PayStatusType): string {
  switch (status) {
    case 'pro':
      return 'bg-purple-500/20';
    case 'enterprise':
      return 'bg-blue-500/20';
    case 'free':
      return 'bg-surface/5';
    default:
      return 'bg-surface/5';
  }
}

/**
 * Parse entitlement packs from JSON string
 */
export function parseEntitlementPacks(json: string | null | undefined): EntitlementPack[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

/**
 * Calculate total available quota from entitlement packs
 */
export function getTotalAvailableQuota(packs: EntitlementPack[]): number {
  return packs.reduce((total, pack) => {
    if (!pack.entitlement_quota) return total;
    const available = pack.entitlement_quota.total_quota - pack.entitlement_quota.used_quota;
    return total + Math.max(0, available);
  }, 0);
}

/**
 * Get quota display info
 */
export function getQuotaDisplay(quota: { total_quota: number; used_quota: number; unit: string }): { used: number; total: number; percent: number; unit: string } {
  const used = quota.used_quota;
  const total = quota.total_quota;
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return { used, total, percent, unit: quota.unit };
}

/**
 * Format date to relative time (e.g., "3 天后过期", "已过期")
 */
export function formatExpiration(expireTime: number | null | undefined): string {
  if (!expireTime) return '永久有效';
  
  const now = Date.now();
  const diff = expireTime - now;
  
  if (diff < 0) {
    return '已过期';
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  
  if (days > 0) {
    return `${days} 天后过期`;
  } else if (hours > 0) {
    return `${hours} 小时后过期`;
  } else {
    return '即将过期';
  }
}

/**
 * Get entitlement type label
 */
export function getEntitlementTypeLabel(pack: EntitlementPack): string {
  // Try to infer from pack name or entitlement key
  const name = (pack.entitlement_pack_name || '').toLowerCase();
  const key = (pack.entitlement?.entitlement_key || '').toLowerCase();
  
  if (name.includes('premium') || key.includes('premium') || name.includes('pro')) {
    return 'Pro 权益';
  }
  if (name.includes('fast') || key.includes('fast') || key.includes('gpt-4') || key.includes('claude')) {
    return '高速模型额度';
  }
  if (name.includes('free') || key.includes('free')) {
    return '免费额度';
  }
  
  return pack.entitlement_pack_name || '权益包';
}
