import { getDatabase } from './database';
import { getTraeworkService } from './traework.service';
import { store } from '../utils/store';
import { logger } from '../utils/logger';
import type { DeviceItem } from '../../shared/types';

/**
 * 获取本地当前日期字符串（YYYY-MM-DD），用于按天统计和跨天自动重置
 */
export function getLocalTodayDateString(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class DeviceService {
  private traeworkInstance?: ReturnType<typeof getTraeworkService>;

  constructor(traework?: ReturnType<typeof getTraeworkService>) {
    if (traework) {
      this.traeworkInstance = traework;
    }
  }

  get traework(): ReturnType<typeof getTraeworkService> {
    if (!this.traeworkInstance) {
      this.traeworkInstance = getTraeworkService();
    }
    return this.traeworkInstance;
  }

  set traework(service: ReturnType<typeof getTraeworkService>) {
    this.traeworkInstance = service;
  }

  /**
   * 校验外部录入的设备 ID 格式
   */
  validateDeviceId(rawId: string): string {
    if (!rawId || typeof rawId !== 'string') {
      throw new Error('设备 ID 不能为空');
    }
    const trimmed = rawId.trim();
    if (!trimmed) {
      throw new Error('设备 ID 不能为空');
    }
    if (trimmed.length < 6 || trimmed.length > 128) {
      throw new Error('设备 ID 长度须在 6 到 128 个字符之间');
    }
    // 允许字母、数字、下划线、连字符、冒号、句点等常见标识符字符
    if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) {
      throw new Error('设备 ID 格式不合法，仅支持字母、数字、下划线、短横线、冒号及点号');
    }
    return trimmed;
  }

  /**
   * 跨天重置检查：若记录的 today_date 不是今天，重置 used_today 状态为 0
   */
  checkAndResetDailyUsage(currentDateStr?: string): void {
    const todayStr = currentDateStr || getLocalTodayDateString();
    const db = getDatabase();
    db.prepare(`
      UPDATE devices
      SET used_today = 0,
          today_date = ?
      WHERE today_date != ? OR today_date IS NULL
    `).run(todayStr, todayStr);
  }

  /**
   * 启动时或手动触发扫描当前机器上已安装的所有 Trae 客户端的合法设备 ID，
   * 去重合并入设备库。
   */
  scanAndSyncLocalDevices(): DeviceItem[] {
    this.checkAndResetDailyUsage();
    const localList = this.traework.getAllTraeDeviceIds();
    const db = getDatabase();
    const todayStr = getLocalTodayDateString();

    const insertOrUpdate = db.transaction(() => {
      for (const item of localList) {
        const existing = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(item.deviceId) as any;
        if (!existing) {
          db.prepare(`
            INSERT INTO devices (device_id, label, is_local, used_today, today_date, created_at, updated_at)
            VALUES (?, ?, 1, 0, ?, datetime('now'), datetime('now'))
          `).run(item.deviceId, `本地 Trae (${item.installName})`, todayStr);
          logger.info(`设备池自动扫描：新增本地设备 ${item.deviceId.slice(0, 8)}... (${item.installName})`);
        } else if (!existing.is_local) {
          db.prepare(`
            UPDATE devices
            SET is_local = 1,
                updated_at = datetime('now')
            WHERE id = ?
          `).run(existing.id);
        }
      }

      // 兼容历史单一 store 存储的 checkin_device_id
      const fallbackId = store.get('checkin_device_id') as string | undefined;
      if (fallbackId && fallbackId.trim()) {
        const cleanFallback = fallbackId.trim();
        const existing = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(cleanFallback) as any;
        if (!existing) {
          db.prepare(`
            INSERT INTO devices (device_id, label, is_local, used_today, today_date, created_at, updated_at)
            VALUES (?, ?, 1, 0, ?, datetime('now'), datetime('now'))
          `).run(cleanFallback, '本地默认设备', todayStr);
        }
      }
    });

    insertOrUpdate();
    return this.getAllDevices();
  }

  /**
   * 获取所有设备列表，自动执行跨天重置并按本地优先排序
   */
  getAllDevices(currentDateStr?: string): DeviceItem[] {
    this.checkAndResetDailyUsage(currentDateStr);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, device_id, label, is_local, last_used_at, used_today, today_date, created_at, updated_at
      FROM devices
      ORDER BY is_local DESC, id ASC
    `).all() as Array<{
      id: number;
      device_id: string;
      label: string;
      is_local: number;
      last_used_at: string | null;
      used_today: number;
      today_date: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      deviceId: r.device_id,
      label: r.label,
      isLocal: Boolean(r.is_local),
      lastUsedAt: r.last_used_at,
      usedToday: Boolean(r.used_today),
      todayDate: r.today_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * 手动录入外部设备 ID
   */
  addDevice(rawDeviceId: string, label?: string): DeviceItem {
    const deviceId = this.validateDeviceId(rawDeviceId);
    this.checkAndResetDailyUsage();
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM devices WHERE device_id = ?').get(deviceId);
    if (existing) {
      throw new Error('该设备 ID 已存在于设备池中');
    }

    const deviceLabel = (label && label.trim()) ? label.trim() : '外部设备';
    const todayStr = getLocalTodayDateString();

    const result = db.prepare(`
      INSERT INTO devices (device_id, label, is_local, used_today, today_date, created_at, updated_at)
      VALUES (?, ?, 0, 0, ?, datetime('now'), datetime('now'))
    `).run(deviceId, deviceLabel, todayStr);

    logger.info(`手动添加外部设备 ID: ${deviceId.slice(0, 8)}... (${deviceLabel})`);

    const inserted = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid) as any;
    return {
      id: inserted.id,
      deviceId: inserted.device_id,
      label: inserted.label,
      isLocal: Boolean(inserted.is_local),
      lastUsedAt: inserted.last_used_at,
      usedToday: Boolean(inserted.used_today),
      todayDate: inserted.today_date,
      createdAt: inserted.created_at,
      updatedAt: inserted.updated_at,
    };
  }

  /**
   * 修改设备备注名称
   */
  updateDevice(id: number, rawLabel: string): DeviceItem {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
    if (!existing) {
      throw new Error('设备不存在');
    }

    const newLabel = (rawLabel ?? '').trim();
    db.prepare(`
      UPDATE devices
      SET label = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newLabel, id);

    const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
    return {
      id: updated.id,
      deviceId: updated.device_id,
      label: updated.label,
      isLocal: Boolean(updated.is_local),
      lastUsedAt: updated.last_used_at,
      usedToday: Boolean(updated.used_today),
      todayDate: updated.today_date,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    };
  }

  /**
   * 删除外部设备（本地内置设备不可删除）
   */
  deleteDevice(id: number): void {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
    if (!existing) {
      throw new Error('设备不存在');
    }

    if (existing.is_local) {
      throw new Error('本地检测到的内置设备不可删除');
    }

    // 采用原子事务：先解绑使用该设备 ID 的账号，再彻底删除设备记录
    const runDeleteTx = db.transaction(() => {
      db.prepare('UPDATE accounts SET bound_device_id = NULL WHERE bound_device_id = ?').run(existing.device_id);
      db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    });
    runDeleteTx();

    logger.info(`删除外部设备: ${existing.device_id.slice(0, 8)}... (${existing.label})`);
  }

  /**
   * 测试设备 ID
   */
  testDevice(rawDeviceId: string): { success: boolean; message: string; usedToday: boolean } {
    const deviceId = this.validateDeviceId(rawDeviceId);
    this.checkAndResetDailyUsage();
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as any;

    if (!existing) {
      return {
        success: true,
        message: '设备 ID 格式有效（尚未保存至本地设备池）',
        usedToday: false,
      };
    }

    const usedToday = Boolean(existing.used_today);
    return {
      success: true,
      message: `设备状态正常：${usedToday ? '今日已签到' : '空闲可用'}`,
      usedToday,
    };
  }

  /**
   * 根据 deviceId 查找设备记录
   */
  findDevice(deviceId: string): DeviceItem | null {
    const db = getDatabase();
    const r = db.prepare(`
      SELECT id, device_id, label, is_local, last_used_at, used_today, today_date, created_at, updated_at
      FROM devices
      WHERE device_id = ?
    `).get(deviceId) as any;
    if (!r) return null;
    return {
      id: r.id,
      deviceId: r.device_id,
      label: r.label,
      isLocal: Boolean(r.is_local),
      lastUsedAt: r.last_used_at,
      usedToday: Boolean(r.used_today),
      todayDate: r.today_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * 标记设备今日已成功完成签到
   */
  markDeviceUsed(deviceId: string): void {
    const todayStr = getLocalTodayDateString();
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM devices WHERE device_id = ?').get(deviceId) as any;
    if (existing) {
      db.prepare(`
        UPDATE devices
        SET used_today = 1,
            today_date = ?,
            last_used_at = datetime('now'),
            updated_at = datetime('now')
        WHERE device_id = ?
      `).run(todayStr, deviceId);
    } else {
      let isLocal = 0;
      try {
        const localList = this.traework.getAllTraeDeviceIds();
        if (localList.some(d => d.deviceId === deviceId)) {
          isLocal = 1;
        }
      } catch {
        // 忽略检测异常
      }
      db.prepare(`
        INSERT INTO devices (device_id, label, is_local, used_today, today_date, last_used_at, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'), datetime('now'))
      `).run(deviceId, isLocal ? '本地设备' : '外部设备', isLocal, todayStr);
    }
    logger.info(`标记设备 ${deviceId.slice(0, 8)}... 今日已成功签到`);
  }

  /**
   * 标记设备今日名额已达上限（例如服务端返回 9095 报错），当天不再选派该设备
   */
  markDeviceLimitReached(deviceId: string): void {
    const todayStr = getLocalTodayDateString();
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM devices WHERE device_id = ?').get(deviceId) as any;
    if (existing) {
      db.prepare(`
        UPDATE devices
        SET used_today = 1,
            today_date = ?,
            updated_at = datetime('now')
        WHERE device_id = ?
      `).run(todayStr, deviceId);
    } else {
      let isLocal = 0;
      try {
        const localList = this.traework.getAllTraeDeviceIds();
        if (localList.some(d => d.deviceId === deviceId)) {
          isLocal = 1;
        }
      } catch {
        // 忽略检测异常
      }
      db.prepare(`
        INSERT INTO devices (device_id, label, is_local, used_today, today_date, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'))
      `).run(deviceId, isLocal ? '本地设备' : '外部设备', isLocal, todayStr);
    }
    logger.info(`设备 ${deviceId.slice(0, 8)}... 今日配额已用尽（9095），已标记今日占用`);
  }

  /**
   * 当前正在被并发签到任务占用的设备租约集合（HTTP 请求执行期间锁定），
   * 防止高并发或多任务同时签到时分配至同一台设备导致 9095 冲突。
   */
  private activeLeases = new Set<string>();

  /**
   * 尝试获取设备租约
   */
  acquireDeviceLease(deviceId: string): boolean {
    if (!deviceId) return false;
    if (this.activeLeases.has(deviceId)) {
      return false;
    }
    this.activeLeases.add(deviceId);
    return true;
  }

  /**
   * 释放设备租约
   */
  releaseDeviceLease(deviceId: string): void {
    if (deviceId) {
      this.activeLeases.delete(deviceId);
    }
  }

  /**
   * 检查设备当前是否处于租约占用中
   */
  isDeviceLeased(deviceId: string): boolean {
    return Boolean(deviceId && this.activeLeases.has(deviceId));
  }

  /**
   * 清空所有活动租约
   */
  clearAllLeases(): void {
    this.activeLeases.clear();
  }

  /**
   * 挑选签到可用设备 ID 候选列表：
   * 1. 账号绑定模式：指定了 boundDeviceId 时，严格使用绑定的设备
   * 2. 自动轮换模式：优先挑选今日未签到（used_today = 0）且未被其他并发任务租用的空闲设备 ID
   */
  getCandidateDevices(boundDeviceId?: string | null, currentDateStr?: string): string[] {
    this.checkAndResetDailyUsage(currentDateStr);
    const db = getDatabase();

    // 账号绑定模式：严格使用绑定的设备 ID
    if (boundDeviceId && boundDeviceId.trim()) {
      return [boundDeviceId.trim()];
    }

    // 自动轮换模式：优先挑选今日尚未签到成功的空闲设备
    const rows = db.prepare(`
      SELECT device_id
      FROM devices
      WHERE used_today = 0
      ORDER BY is_local DESC, id ASC
    `).all() as Array<{ device_id: string }>;

    const allUnused = rows.map(r => r.device_id);

    // 优先返回未被当前其他任务租用的空闲设备，已被租用的排在后面兜底
    const unleased = allUnused.filter(id => !this.activeLeases.has(id));
    if (unleased.length > 0) {
      const leased = allUnused.filter(id => this.activeLeases.has(id));
      return [...unleased, ...leased];
    }

    return allUnused;
  }
}

// 单例模式
let deviceServiceInstance: DeviceService | null = null;

export function getDeviceService(): DeviceService {
  if (!deviceServiceInstance) {
    deviceServiceInstance = new DeviceService();
  }
  return deviceServiceInstance;
}
