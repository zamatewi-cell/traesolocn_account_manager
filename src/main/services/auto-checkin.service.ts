import { BrowserWindow } from 'electron';
import { getDatabase } from './database';
import { getCheckinService } from './checkin.service';
import { getAccountService } from './account.service';
import { store } from '../utils/store';
import { logger } from '../utils/logger';
import type { AutoCheckinRecord, AutoCheckinStatus, BatchCheckinResult } from '../../shared/types';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class AutoCheckinService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** 计划中的下次触发时间（本地 ISO），用于状态展示与重复调度保护 */
  private nextRunAt: Date | null = null;
  private completedListeners: Array<(record: AutoCheckinRecord) => void> = [];

  getSettings(): { enabled: boolean; start: string; end: string } {
    return {
      enabled: store.get('autoCheckinEnabled', false) as boolean,
      start: store.get('autoCheckinStart', '06:00') as string,
      end: store.get('autoCheckinEnd', '12:00') as string,
    };
  }

  updateSettings(patch: { enabled?: boolean; start?: string; end?: string }): { enabled: boolean; start: string; end: string } {
    const current = this.getSettings();
    const start = patch.start ?? current.start;
    const end = patch.end ?? current.end;

    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      throw new Error('时间格式无效，应为 HH:mm');
    }
    if (start >= end) {
      throw new Error('开始时间必须早于结束时间');
    }

    if (patch.enabled !== undefined) store.set('autoCheckinEnabled', patch.enabled);
    if (patch.start !== undefined) store.set('autoCheckinStart', patch.start);
    if (patch.end !== undefined) store.set('autoCheckinEnd', patch.end);

    // Time window may have changed: reschedule from scratch. Enabling needs a
    // fresh plan; disabling must clear the pending timer.
    this.reschedule();
    return this.getSettings();
  }

  getStatus(): AutoCheckinStatus {
    const settings = this.getSettings();
    return {
      enabled: settings.enabled,
      start: settings.start,
      end: settings.end,
      nextRunAt: settings.enabled && this.nextRunAt ? this.nextRunAt.toISOString() : null,
      hasRunToday: this.hasRunToday(),
    };
  }

  getRecords(): AutoCheckinRecord[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, trigger_type, run_at, duration_ms, success_count, already_count, failed_count, total, results_json FROM auto_checkin_records ORDER BY run_at DESC'
    ).all() as Array<{
      id: number;
      trigger_type: string;
      run_at: string;
      duration_ms: number;
      success_count: number;
      already_count: number;
      failed_count: number;
      total: number;
      results_json: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      triggerType: row.trigger_type === 'manual' ? 'manual' : 'auto',
      runAt: row.run_at,
      durationMs: row.duration_ms,
      successCount: row.success_count,
      alreadyCount: row.already_count,
      failedCount: row.failed_count,
      total: row.total,
      results: row.results_json ? JSON.parse(row.results_json) : [],
    }));
  }

  clearRecords(): void {
    const db = getDatabase();
    db.prepare('DELETE FROM auto_checkin_records').run();
    logger.info('[AutoCheckin] All records cleared');
  }

  /** 测试执行：立即运行一次并记录（trigger = manual） */
  async runTest(): Promise<AutoCheckinRecord> {
    return this.execute('manual');
  }

  /** 计划入口：应用启动或设置变化后调用 */
  reschedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;

    const { enabled, start, end } = this.getSettings();
    if (!enabled) {
      logger.info('[AutoCheckin] Disabled, no schedule');
      return;
    }

    const now = new Date();
    const plan = this.planNextRun(now, start, end);
    if (!plan) {
      logger.info('[AutoCheckin] Already ran today; waiting for tomorrow');
      // Re-check after midnight so tomorrow's plan is created even when the
      // app stays running for days.
      this.scheduleWakeup(now, start, end);
      return;
    }

    const delay = plan.getTime() - now.getTime();
    this.nextRunAt = plan;
    logger.info(`[AutoCheckin] Next run at ${plan.toLocaleString()} (in ${Math.round(delay / 1000)}s)`);

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.onTimer(start, end);
    }, Math.max(delay, 1000));
    this.timer.unref?.();
  }

  onCompleted(listener: (record: AutoCheckinRecord) => void): () => void {
    this.completedListeners.push(listener);
    return () => {
      this.completedListeners = this.completedListeners.filter(l => l !== listener);
    };
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
  }

  private async onTimer(start: string, end: string): Promise<void> {
    this.nextRunAt = null;
    try {
      await this.execute('auto');
    } catch (err) {
      logger.error('[AutoCheckin] Scheduled run failed:', err);
    }
    // Plan the next day's run.
    this.reschedule();
    void start; void end;
  }

  /**
   * Decide when the next auto run should happen, relative to `now`:
   * - before the window today -> random time inside today's window
   * - inside the window, not yet run -> random time between now and window end
   * - window over, not yet run -> run right away (catch-up for a machine that
   *   was asleep/off during the window; the checkin API tolerates
   *   already-claimed accounts, so no double-claim risk)
   * - already ran today -> null (caller schedules a midnight re-check)
   */
  private planNextRun(now: Date, start: string, end: string): Date | null {
    if (this.hasRunToday()) return null;

    const failedAttempts = this.failedAutoRunsToday();
    if (failedAttempts > 0) {
      // Back off after a completely failed run instead of immediately
      // hammering the same unavailable network/API. hasRunToday caps this at
      // three automatic attempts per local day.
      return new Date(now.getTime() + 15 * 60 * 1000);
    }

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);

    const windowStart = new Date(now);
    windowStart.setHours(sh, sm, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setHours(eh, em, 0, 0);

    if (now < windowStart) {
      return this.randomTimeBetween(windowStart, windowEnd);
    }
    if (now < windowEnd) {
      return this.randomTimeBetween(now, windowEnd);
    }
    return new Date(now.getTime() + 5000);
  }

  /** Schedule a wakeup shortly after midnight to plan the new day's run. */
  private scheduleWakeup(now: Date, start: string, end: string): void {
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 10, 0);
    const delay = nextMidnight.getTime() - now.getTime();
    this.nextRunAt = null;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.reschedule();
    }, Math.max(delay, 1000));
    this.timer.unref?.();
    void start; void end;
  }

  private randomTimeBetween(from: Date, to: Date): Date {
    const span = to.getTime() - from.getTime();
    if (span <= 0) return new Date(from.getTime());
    return new Date(from.getTime() + Math.floor(Math.random() * span));
  }

  private hasRunToday(): boolean {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(success_count + already_count), 0) AS completed
       FROM auto_checkin_records
       WHERE trigger_type = 'auto' AND date(run_at) = date('now', 'localtime')`
    ).get() as { n: number; completed: number };
    // A run where every account failed (for example during a network outage)
    // is not considered complete. Retry it, but cap attempts so a persistent
    // server error cannot create an endless loop.
    return row.completed > 0 || row.n >= 3;
  }

  private failedAutoRunsToday(): number {
    const db = getDatabase();
    const row = db.prepare(
      `SELECT COUNT(*) AS n
       FROM auto_checkin_records
       WHERE trigger_type = 'auto'
         AND date(run_at) = date('now', 'localtime')
         AND success_count = 0 AND already_count = 0`
    ).get() as { n: number };
    return row.n;
  }

  private async execute(trigger: 'auto' | 'manual'): Promise<AutoCheckinRecord> {
    if (this.running) {
      throw new Error('一次自动签到正在执行中，请稍候');
    }
    this.running = true;
    const startedAt = Date.now();

    try {
      const accounts = getAccountService().getAllAccounts();
      if (accounts.length === 0) {
        throw new Error('没有可签到的账号');
      }

      const result: BatchCheckinResult = await getCheckinService().checkinBatch(accounts.map(a => a.id));
      const runAt = new Date();
      const record = this.saveRecord(trigger, runAt, Date.now() - startedAt, result);

      logger.info(
        `[AutoCheckin] ${trigger === 'auto' ? 'Scheduled' : 'Test'} run finished: ` +
        `${record.successCount} success, ${record.alreadyCount} already, ${record.failedCount} failed (${record.durationMs}ms)`
      );

      this.notifyCompleted(record);
      return record;
    } finally {
      this.running = false;
    }
  }

  private saveRecord(trigger: 'auto' | 'manual', runAt: Date, durationMs: number, result: BatchCheckinResult): AutoCheckinRecord {
    const db = getDatabase();
    const results = result.results.map(r => ({
      accountId: r.accountId,
      accountName: r.accountName ?? '',
      success: r.success,
      alreadyClaimed: r.alreadyClaimed,
      creditsEarned: r.creditsEarned,
      message: r.message ?? '',
    }));

    const runAtLocal = this.formatLocalIso(runAt);
    const info = db.prepare(
      `INSERT INTO auto_checkin_records (trigger_type, run_at, duration_ms, success_count, already_count, failed_count, total, results_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trigger,
      runAtLocal,
      durationMs,
      result.success,
      result.alreadyClaimed,
      result.failed,
      result.total,
      JSON.stringify(results)
    );

    // Rolling 30-day retention
    db.prepare(
      "DELETE FROM auto_checkin_records WHERE run_at < datetime('now', 'localtime', '-30 days')"
    ).run();

    return {
      id: Number(info.lastInsertRowid),
      triggerType: trigger,
      runAt: runAtLocal,
      durationMs,
      successCount: result.success,
      alreadyCount: result.alreadyClaimed,
      failedCount: result.failed,
      total: result.total,
      results,
    };
  }

  /** SQLite datetime('now', 'localtime') 文本格式，与 hasRunToday/保留清理的比较口径一致 */
  private formatLocalIso(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  private notifyCompleted(record: AutoCheckinRecord): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('autocheckin:completed', record);
      } catch {
        // Window may be closing
      }
    }
    for (const listener of this.completedListeners) {
      try {
        listener(record);
      } catch (err) {
        logger.warn('[AutoCheckin] Completed listener failed:', err);
      }
    }
  }
}

// Singleton
let autoCheckinServiceInstance: AutoCheckinService | null = null;

export function getAutoCheckinService(): AutoCheckinService {
  if (!autoCheckinServiceInstance) {
    autoCheckinServiceInstance = new AutoCheckinService();
  }
  return autoCheckinServiceInstance;
}
