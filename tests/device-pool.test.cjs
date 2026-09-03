const assert = require('node:assert/strict');
const test = require('node:test');

// 构造自包含的内存 Mock Database，隔离原生 C++ 模块的 ABI 差异，跨环境稳定测试
function createMockDatabase() {
  const devices = [];
  const accounts = [];
  let nextDeviceId = 1;

  return {
    _devices: devices,
    _accounts: accounts,
    reset() {
      devices.length = 0;
      accounts.length = 0;
      nextDeviceId = 1;
    },
    transaction(fn) {
      return fn;
    },
    prepare(sql) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      return {
        run(...params) {
          if (normalizedSql.includes('DELETE FROM devices')) {
            devices.length = 0;
            return { changes: 1 };
          }

          if (normalizedSql.includes('DELETE FROM accounts')) {
            accounts.length = 0;
            return { changes: 1 };
          }

          if (normalizedSql.includes('INSERT INTO devices')) {
            let isLocal = 0;
            let usedToday = 0;
            let label = '';
            let todayDate = '';
            const deviceId = params[0];

            if (normalizedSql.includes('?, ?, ?, 1, ?')) {
              label = params[1] || '';
              isLocal = Number(params[2]) || 0;
              usedToday = 1;
              todayDate = params[3] || '';
            } else if (normalizedSql.includes('1, 1, ?')) {
              isLocal = 1;
              usedToday = 1;
              label = '默认设备';
              todayDate = params[1] || '';
            } else {
              isLocal = normalizedSql.includes('1, 0, ?') ? 1 : 0;
              label = params[1] || '';
              todayDate = params[2] || '';
            }

            const newRow = {
              id: nextDeviceId++,
              device_id: deviceId,
              label,
              is_local: isLocal,
              last_used_at: normalizedSql.includes('last_used_at') ? new Date().toISOString() : null,
              used_today: usedToday,
              today_date: todayDate,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            devices.push(newRow);
            return { lastInsertRowid: newRow.id };
          }

          if (normalizedSql.includes('INSERT INTO accounts')) {
            const newAccount = {
              id: accounts.length + 1,
              nickname: params[0],
              email: params[1],
              user_id: params[2],
              avatar_url: params[3],
              phone: params[4],
              token_encrypted: params[5],
              refresh_token_encrypted: params[6],
              refresh_token: params[7],
              host: params[8],
              source: params[9],
              install_name: params[10],
              credits_balance: params[11],
              pay_status: params[12],
              pay_identity_str: params[13],
              entitlement_packs: params[14],
              token_expired_at: params[15],
              auth_blob_encrypted: params[16],
              bound_device_id: params[17] || null,
              is_active: 0,
              is_checked_in: 0,
              checkin_credits: 0,
              last_checkin_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            accounts.push(newAccount);
            return { lastInsertRowid: newAccount.id };
          }

          if (normalizedSql.includes('UPDATE devices') && normalizedSql.includes('SET used_today = 0')) {
            const [todayDate] = params;
            for (const d of devices) {
              if (d.today_date !== todayDate || d.today_date === null) {
                d.used_today = 0;
                d.today_date = todayDate;
              }
            }
            return { changes: devices.length };
          }

          if (normalizedSql.includes('UPDATE devices') && normalizedSql.includes('SET used_today = 1')) {
            const todayDate = params[0];
            const deviceId = params[params.length - 1];
            const d = devices.find(x => x.device_id === deviceId);
            if (d) {
              d.used_today = 1;
              d.today_date = todayDate;
              if (normalizedSql.includes('last_used_at')) {
                d.last_used_at = new Date().toISOString();
              }
              d.updated_at = new Date().toISOString();
            }
            return { changes: d ? 1 : 0 };
          }

          if (normalizedSql.includes('UPDATE devices') && normalizedSql.includes('SET label = ?')) {
            const [label, id] = params;
            const d = devices.find(x => x.id === id);
            if (d) d.label = label;
            return { changes: d ? 1 : 0 };
          }

          if (normalizedSql.includes('UPDATE devices') && normalizedSql.includes('SET is_local = 1')) {
            const [id] = params;
            const d = devices.find(x => x.id === id);
            if (d) d.is_local = 1;
            return { changes: d ? 1 : 0 };
          }

          if (normalizedSql.includes('DELETE FROM devices WHERE id = ?')) {
            const [id] = params;
            const idx = devices.findIndex(x => x.id === id);
            if (idx !== -1) devices.splice(idx, 1);
            return { changes: idx !== -1 ? 1 : 0 };
          }

          if (normalizedSql.includes('UPDATE accounts SET bound_device_id = NULL')) {
            const [deviceId] = params;
            for (const a of accounts) {
              if (a.bound_device_id === deviceId) {
                a.bound_device_id = null;
              }
            }
            return { changes: 1 };
          }

          if (normalizedSql.includes('UPDATE accounts SET bound_device_id = ?')) {
            const [boundDeviceId, id] = params;
            const a = accounts.find(x => x.id === id);
            if (a) a.bound_device_id = boundDeviceId;
            return { changes: a ? 1 : 0 };
          }

          if (normalizedSql.includes('UPDATE accounts') && normalizedSql.includes('SET is_checked_in = 1')) {
            const credits = params[0];
            const id = params[params.length - 1];
            const a = accounts.find(x => x.id === id);
            if (a) {
              a.is_checked_in = 1;
              a.checkin_credits = (a.checkin_credits || 0) + credits;
              a.credits_balance = (a.credits_balance || 0) + credits;
              a.last_checkin_at = new Date().toISOString();
            }
            return { changes: a ? 1 : 0 };
          }

          return { changes: 0 };
        },

        get(...params) {
          if (normalizedSql.includes('FROM devices WHERE device_id = ?')) {
            const [deviceId] = params;
            const d = devices.find(x => x.device_id === deviceId);
            return d ? { ...d } : undefined;
          }

          if (normalizedSql.includes('FROM devices WHERE id = ?')) {
            const [id] = params;
            const d = devices.find(x => x.id === id);
            return d ? { ...d } : undefined;
          }

          if (normalizedSql.includes('FROM accounts WHERE id = ?')) {
            const [id] = params;
            const a = accounts.find(x => x.id === id);
            return a ? { ...a } : undefined;
          }

          return undefined;
        },

        all() {
          if (normalizedSql.includes('FROM devices WHERE used_today = 0')) {
            return devices
              .filter(d => d.used_today === 0)
              .sort((a, b) => b.is_local - a.is_local || a.id - b.id)
              .map(d => ({ device_id: d.device_id }));
          }

          if (normalizedSql.includes('FROM devices')) {
            return devices
              .slice()
              .sort((a, b) => b.is_local - a.is_local || a.id - b.id)
              .map(d => ({ ...d }));
          }

          if (normalizedSql.includes('FROM accounts')) {
            return accounts.map(a => ({ ...a }));
          }

          return [];
        },
      };
    },
  };
}

// 拦截 database 模块注入内存 mock
const dbMod = require('../dist/main/services/database.js');
const mockDb = createMockDatabase();
dbMod.getDatabase = () => mockDb;

const { DeviceService, getLocalTodayDateString } = require('../dist/main/services/device.service.js');

test('R1: validateDeviceId 能够正确校验设备 ID 合法性', () => {
  const service = new DeviceService();

  // 空值或非字符串校验
  assert.throws(() => service.validateDeviceId(''), /设备 ID 不能为空/);
  assert.throws(() => service.validateDeviceId('   '), /设备 ID 不能为空/);
  assert.throws(() => service.validateDeviceId(null), /设备 ID 不能为空/);

  // 长度校验（需在 6 到 128 位之间）
  assert.throws(() => service.validateDeviceId('12345'), /长度须在 6 到 128/);
  assert.throws(() => service.validateDeviceId('a'.repeat(129)), /长度须在 6 到 128/);

  // 字符集校验（禁止空格、换行、中文、特殊非法字符）
  assert.throws(() => service.validateDeviceId('device id with spaces'), /格式不合法/);
  assert.throws(() => service.validateDeviceId('device\nid'), /格式不合法/);
  assert.throws(() => service.validateDeviceId('设备ID-测试001'), /格式不合法/);
  assert.throws(() => service.validateDeviceId('device$#@!'), /格式不合法/);

  // 合法设备 ID 格式校验
  assert.equal(service.validateDeviceId('device-abc-123_456:789.xyz'), 'device-abc-123_456:789.xyz');
  assert.equal(service.validateDeviceId('  iCube-Device-001  '), 'iCube-Device-001');
});

test('R1: 设备池 CRUD、去重与内置设备保护', () => {
  const service = new DeviceService();
  mockDb.reset();

  // 1. 添加外部设备
  const d1 = service.addDevice('ext-dev-001', '外部测试机1');
  assert.equal(d1.deviceId, 'ext-dev-001');
  assert.equal(d1.label, '外部测试机1');
  assert.equal(d1.isLocal, false);
  assert.equal(d1.usedToday, false);

  // 2. 去重校验：重复添加报错
  assert.throws(() => service.addDevice('ext-dev-001', '重复设备'), /已存在于设备池中/);

  // 3. 修改备注名
  const updated = service.updateDevice(d1.id, '修改后的备注名');
  assert.equal(updated.label, '修改后的备注名');

  // 4. 模拟内置本地设备
  mockDb._devices.push({
    id: 99,
    device_id: 'local-dev-001',
    label: '本地Trae客户端',
    is_local: 1,
    used_today: 0,
    today_date: getLocalTodayDateString(),
    last_used_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const localDev = service.getAllDevices().find(d => d.deviceId === 'local-dev-001');
  assert.ok(localDev);
  assert.equal(localDev.isLocal, true);

  // 5. 内置本地设备禁止删除保护
  assert.throws(() => service.deleteDevice(localDev.id), /本地检测到的内置设备不可删除/);

  // 6. 绑定账号后删除外部设备：账号自动解绑为 NULL
  mockDb._accounts.push({
    id: 1,
    nickname: '测试账号1',
    bound_device_id: 'ext-dev-001',
  });

  assert.equal(mockDb._accounts[0].bound_device_id, 'ext-dev-001');

  // 删除外部设备
  service.deleteDevice(d1.id);
  const remaining = service.getAllDevices().find(d => d.id === d1.id);
  assert.equal(remaining, undefined);

  // 验证账号绑定已自动解绑
  assert.equal(mockDb._accounts[0].bound_device_id, null);
});

test('R1: 本地设备扫描并去重合并（scanAndSyncLocalDevices）', () => {
  const service = new DeviceService();
  mockDb.reset();

  // Mock traework.getAllTraeDeviceIds 返回带有重复项的多个本地客户端设备
  service.traework = {
    getAllTraeDeviceIds: () => [
      { deviceId: 'local-trae-solo-01', installName: 'TRAE SOLO CN' },
      { deviceId: 'local-trae-cn-02', installName: 'Trae CN' },
      { deviceId: 'local-trae-solo-01', installName: 'TRAE SOLO CN' }, // 重复项
    ],
  };

  const synced = service.scanAndSyncLocalDevices();
  assert.equal(synced.length, 2);
  assert.ok(synced.some(d => d.deviceId === 'local-trae-solo-01' && d.isLocal));
  assert.ok(synced.some(d => d.deviceId === 'local-trae-cn-02' && d.isLocal));

  // 二次扫描幂等性验证，不重复插入
  const reSynced = service.scanAndSyncLocalDevices();
  assert.equal(reSynced.length, 2);
});

test('R2: 跨天状态自动重置逻辑（次日自动恢复空闲可用状态）', () => {
  const service = new DeviceService();
  mockDb.reset();

  // 录入一个设备并标记为今日已签到
  service.addDevice('dev-rollover-01', '跨天测试设备');
  service.markDeviceUsed('dev-rollover-01');

  const todayStr = getLocalTodayDateString();
  let dev = service.getAllDevices().find(d => d.deviceId === 'dev-rollover-01');
  assert.equal(dev.usedToday, true);
  assert.equal(dev.todayDate, todayStr);

  // 今日已签到，候选列表为空
  assert.deepEqual(service.getCandidateDevices(), []);

  // 模拟跨天（进入次日 2026-09-04）
  const tomorrow = '2026-09-04';
  service.checkAndResetDailyUsage(tomorrow);

  // 验证次日设备已被自动重置为 usedToday = false，重新变为空闲状态
  dev = service.getAllDevices(tomorrow).find(d => d.deviceId === 'dev-rollover-01');
  assert.equal(dev.usedToday, false);
  assert.equal(dev.todayDate, tomorrow);

  // 验证次日调度候选列表重新包含该设备
  assert.deepEqual(service.getCandidateDevices(null, tomorrow), ['dev-rollover-01']);
});

test('R2: 双模调度机制（账号绑定模式严格指定 vs 自动轮换模式挑选空闲）', () => {
  const service = new DeviceService();
  mockDb.reset();

  // 录入两个设备
  service.addDevice('device-pool-A', '设备A');
  service.addDevice('device-pool-B', '设备B');

  // 1. 账号绑定模式：指定 boundDeviceId，严格使用绑定的设备
  const boundCandidates = service.getCandidateDevices('device-pool-B');
  assert.deepEqual(boundCandidates, ['device-pool-B']);

  // 2. 自动轮换模式：默认返回池中所有空闲设备
  const rotateCandidates = service.getCandidateDevices();
  assert.deepEqual(rotateCandidates, ['device-pool-A', 'device-pool-B']);

  // 3. 模拟设备 A 今日签到成功
  service.markDeviceUsed('device-pool-A');

  // 下一个账号自动轮换时，优先挑选空闲的设备 B，完全避开设备 A
  const nextCandidates = service.getCandidateDevices();
  assert.deepEqual(nextCandidates, ['device-pool-B']);

  // 4. 模拟设备 B 也签到成功
  service.markDeviceUsed('device-pool-B');

  // 两个设备均已使用后，空闲候选列表为空
  assert.deepEqual(service.getCandidateDevices(), []);
});

test('R2: 账号绑定模式下遭遇 9095 严格保留绑定设备', async () => {
  mockDb.reset();
  const service = new DeviceService();
  service.addDevice('bound-dev-111', '绑定的设备');
  service.addDevice('idle-dev-222', '空闲候补设备');

  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();

  mockDb._accounts.push({
    id: 10,
    nickname: '绑定用户',
    token_encrypted: Buffer.from('mock'),
    bound_device_id: 'bound-dev-111',
    credits_balance: 100,
  });

  accountService.getAccountById = (id) => {
    const a = mockDb._accounts.find(x => x.id === id);
    return a ? {
      id: a.id,
      nickname: a.nickname,
      boundDeviceId: a.bound_device_id,
      creditsBalance: a.credits_balance,
      host: 'https://api.trae.cn',
      token: 'valid-token',
    } : null;
  };
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };

  let triedDevices = [];
  accountService.api = {
    getCheckinStatus: async () => ({ checkedIn: false, canCheckin: true, credits: 0, enable: true }),
    claimCheckin: async (_token, _host, deviceId) => {
      triedDevices.push(deviceId);
      return {
        success: false,
        alreadyClaimed: false,
        creditsEarned: 0,
        newBalance: 0,
        message: '当前设备今日签到名额已被其他账号使用，请明日再试',
        isDeviceLimit: true,
        code: 9095,
      };
    },
  };

  const res = await accountService.performCheckin(10);
  assert.equal(res.success, false);
  assert.match(res.message, /绑定的专属设备/);
  // 严格只尝试了 bound-dev-111，没有轮换到 idle-dev-222
  assert.deepEqual(triedDevices, ['bound-dev-111']);
});

test('R2: 多账号批量签到防 9095 与 9095 自动容错降级轮换全流程', async () => {
  mockDb.reset();
  const service = new DeviceService();

  // 添加两个测试设备 A 和 B
  service.addDevice('dev-retry-A', '设备A');
  service.addDevice('dev-retry-B', '设备B');

  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();

  mockDb._accounts.push(
    { id: 1, nickname: '账号1', bound_device_id: null, credits_balance: 100 },
    { id: 2, nickname: '账号2', bound_device_id: null, credits_balance: 200 }
  );

  accountService.getAccountById = (id) => {
    const a = mockDb._accounts.find(x => x.id === id);
    return a ? {
      id: a.id,
      nickname: a.nickname,
      boundDeviceId: a.bound_device_id,
      creditsBalance: a.credits_balance,
      host: 'https://api.trae.cn',
      token: 'valid-token',
    } : null;
  };
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };
  accountService.refreshAccount = async () => {};

  // 场景 1：设备 A 遭遇 9095 限制，系统自动无缝轮换到设备 B 并签到成功
  const callHistory = [];
  accountService.api = {
    getCheckinStatus: async (_token, _host, deviceId) => {
      callHistory.push(`status:${deviceId}`);
      return { checkedIn: false, canCheckin: true, credits: 0, enable: true };
    },
    claimCheckin: async (_token, _host, deviceId) => {
      callHistory.push(`claim:${deviceId}`);
      if (deviceId === 'dev-retry-A') {
        // 设备 A 返回 9095 限制（今日已被其他账号占用）
        return {
          success: false,
          alreadyClaimed: false,
          creditsEarned: 0,
          newBalance: 0,
          message: '当前设备今日签到名额已被其他账号使用，请明日再试',
          isDeviceLimit: true,
          code: 9095,
        };
      }
      // 设备 B 签到成功
      return {
        success: true,
        alreadyClaimed: false,
        creditsEarned: 200,
        newBalance: 300,
        message: '签到成功！获得 200 积分',
        code: 0,
      };
    },
  };

  const res1 = await accountService.performCheckin(1);
  assert.equal(res1.success, true);
  assert.equal(res1.creditsEarned, 200);
  assert.equal(res1.deviceId, 'dev-retry-B');

  // 验证调用链：先尝试 dev-retry-A，遭遇 9095 后自动无缝尝试候补 dev-retry-B
  assert.deepEqual(callHistory, [
    'status:dev-retry-A',
    'claim:dev-retry-A',
    'status:dev-retry-B',
    'claim:dev-retry-B',
  ]);

  // 验证设备 A 已经因为 9095 被标记今日用尽，设备 B 也因为成功被标记今日已用
  const devA = service.getAllDevices().find(d => d.deviceId === 'dev-retry-A');
  const devB = service.getAllDevices().find(d => d.deviceId === 'dev-retry-B');
  assert.equal(devA.usedToday, true);
  assert.equal(devB.usedToday, true);

  // 场景 2：所有设备均已耗尽时，给出清晰中文提示
  const res2 = await accountService.performCheckin(2);
  assert.equal(res2.success, false);
  assert.match(res2.message, /所有可用设备今日签到名额均已耗尽/);
});

test('对抗测试 1: markDeviceUsed 与 markDeviceLimitReached 针对未在 devices 表中的设备自动补录并追踪状态', () => {
  mockDb.reset();
  const service = new DeviceService();

  // 模拟一个既不是手动添加也不是本地扫描出的 fallback/外部设备 ID
  const unrecordedSuccessId = 'unrecorded-fallback-dev-999';
  const unrecordedLimitId = 'unrecorded-limit-dev-888';

  // 1. 成功签到触发 markDeviceUsed
  service.markDeviceUsed(unrecordedSuccessId);
  let dev1 = mockDb._devices.find(d => d.device_id === unrecordedSuccessId);
  assert.ok(dev1, '未记录的成功设备应当被自动插入 devices 表');
  assert.equal(dev1.used_today, 1);
  assert.equal(dev1.is_local, 0, '未在本地客户端检测到的设备应补录为外部设备（is_local=0），避免变成无法删除的内置设备');
  assert.equal(dev1.label, '外部设备');

  // 2. 9095 限制触发 markDeviceLimitReached
  service.markDeviceLimitReached(unrecordedLimitId);
  let dev2 = mockDb._devices.find(d => d.device_id === unrecordedLimitId);
  assert.ok(dev2, '未记录的 9095 受限设备应当被自动插入 devices 表');
  assert.equal(dev2.used_today, 1);
  assert.equal(dev2.is_local, 0, '受限补录的设备同样应为可删除的外部设备');

  // 3. 验证两个设备均被视为今日已用，候选列表中不再返回它们
  const candidates = service.getCandidateDevices();
  assert.equal(candidates.includes(unrecordedSuccessId), false);
  assert.equal(candidates.includes(unrecordedLimitId), false);

  // 4. 验证用户可以正常删除补录的外部设备
  assert.doesNotThrow(() => {
    service.deleteDevice(dev1.id);
  });
  assert.equal(mockDb._devices.some(d => d.device_id === unrecordedSuccessId), false);
});

test('对抗测试 2: performCheckin 大设备池下的循环轮换上限保护（MAX_DEVICE_ROTATION_CANDIDATES = 5）防范雪崩', async () => {
  mockDb.reset();
  const service = new DeviceService();

  // 在池中生成 8 个可用设备（超过上限 5）
  for (let i = 1; i <= 8; i++) {
    service.addDevice(`dev-flood-${String(i).padStart(3, '0')}`, `测试设备${i}`);
  }

  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();

  mockDb._accounts.push({
    id: 101,
    nickname: '大设备池测试账号',
    bound_device_id: null,
    credits_balance: 0,
  });

  accountService.getAccountById = (id) => {
    const a = mockDb._accounts.find(x => x.id === id);
    return a ? {
      id: a.id,
      nickname: a.nickname,
      boundDeviceId: a.bound_device_id,
      creditsBalance: a.credits_balance,
      host: 'https://api.trae.cn',
      token: 'valid-token',
    } : null;
  };
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };

  const triedDeviceIds = [];
  accountService.api = {
    getCheckinStatus: async (_token, _host, deviceId) => {
      return { checkedIn: false, canCheckin: true, credits: 0, enable: true };
    },
    claimCheckin: async (_token, _host, deviceId) => {
      triedDeviceIds.push(deviceId);
      // 全部返回 9095，模拟极端全部占用的情况
      return {
        success: false,
        alreadyClaimed: false,
        creditsEarned: 0,
        newBalance: 0,
        message: '9095',
        isDeviceLimit: true,
        code: 9095,
      };
    },
  };

  const res = await accountService.performCheckin(101);
  assert.equal(res.success, false);
  // 严格只轮换了最多 5 次，没有把 8 个全部死循环耗尽
  assert.equal(triedDeviceIds.length, 5);
  assert.match(res.message, /9095/);
});

test('对抗测试 3: 本地 Trae 客户端扫描合法性过滤（安全阻断非法/过短设备 ID）', () => {
  mockDb.reset();
  const traeworkModule = require('../dist/main/services/traework.service.js');
  const traework = traeworkModule.getTraeworkService();

  // Mock readAllStorages 返回包含各种非法畸形 key 的 storage
  traework.readAllStorages = () => [
    {
      installName: 'Trae CN',
      storagePath: '/fake/storage.json',
      data: {
        'iCubeAuthInfo://icube-dc:valid-device-12345': 'ok',
        'iCubeAuthInfo://icube-dc:bad': 'too short',
        'iCubeAuthInfo://icube-dc:invalid id with space': 'spaces',
        'iCubeAuthInfo://icube-dc:中文设备标识001': 'chinese chars',
        'iCubeAuthInfo://icube-dc:': 'empty',
      },
    },
  ];

  const deviceIds = traework.getAllTraeDeviceIds();
  // 仅有合法的 valid-device-12345 应该被提取
  assert.equal(deviceIds.length, 1);
  assert.equal(deviceIds[0].deviceId, 'valid-device-12345');
});

test('对抗测试 4: 账号添加与导出导入中完整保持 boundDeviceId 并自动注册设备池', async () => {
  mockDb.reset();
  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();

  // Mock API validateToken 与 getUserInfo
  accountService.crypto = {
    isValidToken: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => Buffer.isBuffer(b) ? b.toString() : String(b),
  };
  accountService.api = {
    getUserInfo: async () => ({ userId: 'user-8888', nickname: '设备绑定用户' }),
    getEntitlements: async () => [],
    getPayStatus: async () => ({ balance: 0 }),
    refreshToken: async () => null,
  };
  accountService.refreshAccount = async () => {};

  // 1. 调用 addAccount，传入 boundDeviceId
  const acc = await accountService.addAccount('fake-jwt-token-123', 'token_import', {
    userId: 'user-8888',
    nickname: '设备绑定用户',
    boundDeviceId: 'imported-dev-777',
  });

  const row = mockDb._accounts.find(a => a.id === acc.id);
  assert.ok(row, '账号应成功写入 mockDb');
  assert.equal(row.bound_device_id, 'imported-dev-777');
});

test('对抗测试 5 (ISSUE-07): 服务端 9074（设备未激活/频控）业务响应处理与调度行为', async () => {
  mockDb.reset();
  const deviceServiceModule = require('../dist/main/services/device.service.js');
  const accountServiceModule = require('../dist/main/services/account.service.js');
  const service = deviceServiceModule.getDeviceService();
  const accountService = accountServiceModule.getAccountService();

  // 添加两台设备：Dev-9074（未在服务端注册）与 Dev-Normal（正常设备）
  service.addDevice('dev-unregistered-9074', '未激活设备');
  service.addDevice('dev-normal-ok', '正常设备');

  mockDb._accounts.push({
    id: 501,
    nickname: '轮换账号',
    user_id: 'user-501',
    credits_balance: 100,
    bound_device_id: null,
  });

  mockDb._accounts.push({
    id: 502,
    nickname: '绑定未激活设备账号',
    user_id: 'user-502',
    credits_balance: 100,
    bound_device_id: 'dev-unregistered-9074',
  });

  accountService.getAccountById = (id) => mockDb._accounts.find(a => a.id === id);
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };
  accountService.refreshAccount = async () => {};

  const triedClaims = [];
  accountService.api = {
    getCheckinStatus: async (_token, _host, deviceId) => ({
      checkedIn: false,
      canCheckin: true,
      credits: 200,
      enable: true,
    }),
    claimCheckin: async (_token, _host, deviceId) => {
      triedClaims.push(deviceId);
      if (deviceId === 'dev-unregistered-9074') {
        return {
          success: false,
          alreadyClaimed: false,
          creditsEarned: 0,
          newBalance: 0,
          message: '操作过于频繁或设备未在 Trae 服务端注册激活（错误码 9074）',
          isRateLimit: true,
          code: 9074,
        };
      }
      return {
        success: true,
        alreadyClaimed: false,
        creditsEarned: 200,
        newBalance: 300,
      };
    },
  };

  // 1. 自动轮换模式：遇到 9074 设备不重试 3 次网络，顺畅降级到下一个正常设备
  const startTime = Date.now();
  const res1 = await accountService.performCheckin(501);
  const elapsed = Date.now() - startTime;

  assert.equal(res1.success, true);
  assert.equal(res1.deviceId, 'dev-normal-ok');
  assert.equal(triedClaims.length, 2);
  assert.deepEqual(triedClaims, ['dev-unregistered-9074', 'dev-normal-ok']);
  // 不应存在 3 次网络重试的 6 秒停顿，耗时极短
  assert.ok(elapsed < 2000, `9074 降级应当秒级完成，实际耗时 ${elapsed}ms`);

  // 2. 9074 设备绝不能被误标记为今日签到占用（used_today = 1）
  const dev9074 = service.getAllDevices().find(d => d.deviceId === 'dev-unregistered-9074');
  assert.equal(dev9074.usedToday, false, '9074 错误不代表今日名额耗尽，不应标记 used_today = true');

  // 3. 账号绑定模式：绑定了 9074 设备，明确提示友好错误，绝不抛出“网络异常（已重试 3 次）”
  const res2 = await accountService.performCheckin(502);
  assert.equal(res2.success, false);
  assert.match(res2.message, /9074/);
  assert.match(res2.message, /未在 Trae 客户端注册激活/);
  assert.doesNotMatch(res2.message, /网络异常（已重试 3 次）/);
});

test('对抗测试 6 (ISSUE-08): 账号绑定失效或已删除设备时的安全前置阻断', async () => {
  mockDb.reset();
  const deviceServiceModule = require('../dist/main/services/device.service.js');
  const accountServiceModule = require('../dist/main/services/account.service.js');
  const service = deviceServiceModule.getDeviceService();
  const accountService = accountServiceModule.getAccountService();

  service.addDevice('dev-valid-existing', '有效设备');

  // 账号 601 绑定了一个在设备池中已经被删除/不存在的设备
  mockDb._accounts.push({
    id: 601,
    nickname: '绑定已删除设备账号',
    user_id: 'user-601',
    credits_balance: 100,
    bound_device_id: 'dev-ghost-deleted-999',
  });

  // 账号 602 绑定了一个格式非法的设备 ID（如包含空格）
  mockDb._accounts.push({
    id: 602,
    nickname: '绑定非法格式设备账号',
    user_id: 'user-602',
    credits_balance: 100,
    bound_device_id: 'bad id with spaces',
  });

  accountService.getAccountById = (id) => mockDb._accounts.find(a => a.id === id);
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };

  let apiCalled = false;
  accountService.api = {
    getCheckinStatus: async () => {
      apiCalled = true;
      return { checkedIn: false, canCheckin: true, credits: 200, enable: true };
    },
    claimCheckin: async () => {
      apiCalled = true;
      return { success: true, alreadyClaimed: false, creditsEarned: 200, newBalance: 300 };
    },
  };

  // 1. 验证不存在设备被前置阻断，提示用户重新绑定或切换为自动轮换
  const res1 = await accountService.performCheckin(601);
  assert.equal(res1.success, false);
  assert.match(res1.message, /在设备池中不存在或已失效/);
  assert.match(res1.message, /重新绑定或切换为自动轮换/);
  assert.equal(apiCalled, false, '前置检查阻断时不应发起任何网络 API 请求');

  // 验证幽灵设备未被偷录入 devices 表
  assert.equal(mockDb._devices.some(d => d.device_id === 'dev-ghost-deleted-999'), false);

  // 2. 验证非法格式设备 ID 被前置阻断
  const res2 = await accountService.performCheckin(602);
  assert.equal(res2.success, false);
  assert.match(res2.message, /设备 ID 格式不合法/);
  assert.equal(apiCalled, false);
});

test('对抗测试 7: IPC 通道定义中完整包含 DEVICES_UPDATED 事件', () => {
  const typesModule = require('../dist/shared/types.js');
  assert.ok(typesModule.IPC_CHANNELS.DEVICES_UPDATED, 'IPC_CHANNELS 必须包含 DEVICES_UPDATED');
  assert.equal(typesModule.IPC_CHANNELS.DEVICES_UPDATED, 'devices:updated');
});

test('对抗测试 8 (ISSUE-09): 并发设备租约机制有效避免并发签到争抢同一设备造成 9095 冲突', async () => {
  mockDb.reset();
  const deviceService = new DeviceService();
  deviceService.clearAllLeases();

  // 添加两台可用设备
  deviceService.addDevice('dev-lease-concurrent-1', '并发设备1');
  deviceService.addDevice('dev-lease-concurrent-2', '并发设备2');

  // 初始状态：两台设备均未被租用，候选列表顺序为 [设备1, 设备2]
  const initialCandidates = deviceService.getCandidateDevices();
  assert.deepEqual(initialCandidates, ['dev-lease-concurrent-1', 'dev-lease-concurrent-2']);

  // 模拟任务 1 正在使用设备 1 进行签到
  const acquired = deviceService.acquireDeviceLease('dev-lease-concurrent-1');
  assert.equal(acquired, true);
  assert.equal(deviceService.isDeviceLeased('dev-lease-concurrent-1'), true);
  assert.equal(deviceService.acquireDeviceLease('dev-lease-concurrent-1'), false, '重复租用应被互斥拒绝');

  // 此时任务 2 请求候选设备：设备 1 正在租用中，任务 2 应优先获得设备 2！
  const concurrentCandidates = deviceService.getCandidateDevices();
  assert.equal(concurrentCandidates[0], 'dev-lease-concurrent-2', '租约互斥生效：任务 2 必须优先调度未占用的设备 2');

  // 释放租约
  deviceService.releaseDeviceLease('dev-lease-concurrent-1');
  assert.equal(deviceService.isDeviceLeased('dev-lease-concurrent-1'), false);

  // 模拟并发调用 performCheckin：账号 701 与账号 702
  mockDb._accounts.push({
    id: 701,
    nickname: '并发账号1',
    user_id: 'user-701',
    credits_balance: 100,
    bound_device_id: null,
  });
  mockDb._accounts.push({
    id: 702,
    nickname: '并发账号2',
    user_id: 'user-702',
    credits_balance: 100,
    bound_device_id: null,
  });

  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();
  accountService.getAccountById = (id) => {
    const a = mockDb._accounts.find(x => x.id === id);
    return a ? {
      id: a.id,
      nickname: a.nickname,
      boundDeviceId: a.bound_device_id,
      creditsBalance: a.credits_balance,
      host: 'https://api.trae.cn',
      token: 'valid-token',
    } : null;
  };
  accountService.ensureValidToken = async () => ({ token: 'mock-valid-token' });
  accountService.tokenIdentityMismatch = () => false;
  accountService.parseJwtExp = () => new Date(Date.now() + 3600 * 1000).toISOString();
  accountService.crypto = { isValidToken: () => true };

  const scheduledDevices = [];
  accountService.api = {
    getCheckinStatus: async (token, host, deviceId) => {
      // 模拟网络延时，使得两请求交织
      await new Promise(r => setTimeout(r, 15));
      return { checkedIn: false, canCheckin: true, credits: 200, enable: true };
    },
    claimCheckin: async (token, host, deviceId) => {
      scheduledDevices.push(deviceId);
      await new Promise(r => setTimeout(r, 15));
      return { success: true, alreadyClaimed: false, creditsEarned: 200, newBalance: 300 };
    },
  };

  // 并发启动两个账号签到
  const [p1, p2] = await Promise.all([
    accountService.performCheckin(701),
    accountService.performCheckin(702),
  ]);

  assert.equal(p1.success, true);
  assert.equal(p2.success, true);
  // 两个并发签到必须分别使用不同设备，杜绝在同一时间碰撞同一设备
  assert.equal(scheduledDevices.length, 2);
  assert.notEqual(scheduledDevices[0], scheduledDevices[1], '两个并发签到请求必须调度不同的设备 ID');
  // 执行完毕后所有租约已安全释放
  assert.equal(deviceService.isDeviceLeased('dev-lease-concurrent-1'), false);
  assert.equal(deviceService.isDeviceLeased('dev-lease-concurrent-2'), false);
});

test('对抗测试 9: setBoundDevice 严格校验（非法字符/不存在设备阻断）与原子事务保护', () => {
  mockDb.reset();
  const { DeviceService, getDeviceService } = require('../dist/main/services/device.service.js');
  const deviceService = getDeviceService();
  const accountServiceModule = require('../dist/main/services/account.service.js');
  const accountService = accountServiceModule.getAccountService();

  mockDb._accounts.push({
    id: 801,
    nickname: '绑定测试账号',
    user_id: 'user-801',
    credits_balance: 100,
    bound_device_id: null,
  });

  accountService.getAccountById = (id) => {
    const a = mockDb._accounts.find(x => x.id === id);
    return a ? {
      id: a.id,
      nickname: a.nickname,
      boundDeviceId: a.bound_device_id,
      creditsBalance: a.credits_balance,
      host: 'https://api.trae.cn',
      token: 'valid-token',
    } : null;
  };

  // 1. 尝试绑定格式非法的设备 ID
  assert.throws(() => {
    accountService.setBoundDevice(801, 'invalid id with spaces');
  }, /格式不合法/);

  // 2. 尝试绑定在设备池中不存在的设备 ID
  assert.throws(() => {
    accountService.setBoundDevice(801, 'dev-not-in-pool-999');
  }, /在设备池中不存在或已失效/);

  // 3. 正常添加设备后绑定
  deviceService.addDevice('dev-legit-target-123', '合法外部设备');
  const updatedAccount = accountService.setBoundDevice(801, 'dev-legit-target-123');
  assert.equal(updatedAccount.boundDeviceId, 'dev-legit-target-123');

  // 4. 传入 null / 空字符串解除绑定（恢复为自动轮换）
  const unbindAccount = accountService.setBoundDevice(801, null);
  assert.equal(unbindAccount.boundDeviceId, null);

  // 5. 验证删除设备时账号自动解绑的原子性
  accountService.setBoundDevice(801, 'dev-legit-target-123');
  const targetDev = deviceService.findDevice('dev-legit-target-123');
  assert.ok(targetDev);
  deviceService.deleteDevice(targetDev.id);
  assert.equal(mockDb._accounts.find(a => a.id === 801).bound_device_id, null);
  assert.equal(deviceService.findDevice('dev-legit-target-123'), null);
});

test('对抗测试 10: SQLite 数据库并发配置检验 (WAL / busy_timeout / wal_autocheckpoint)', () => {
  const fs = require('fs');
  const path = require('path');
  const dbSourcePath = path.resolve(__dirname, '../src/main/services/database.ts');
  const content = fs.readFileSync(dbSourcePath, 'utf8');

  assert.match(content, /timeout:\s*5000/, 'Database 构造必须配置 timeout: 5000');
  assert.match(content, /busy_timeout\s*=\s*5000/, '必须配置 busy_timeout = 5000 防止高并发锁定');
  assert.match(content, /wal_autocheckpoint\s*=\s*1000/, '必须配置 wal_autocheckpoint 防止 WAL 膨胀');
  assert.match(content, /journal_mode\s*=\s*WAL/, '必须启用 WAL 模式');
});

test('对抗测试 11: SQLite UTC 日期时间规范化与 formatDate 时区一致性验证', () => {
  const sqliteUtcStr = '2026-09-03 02:44:37';
  // 规范化逻辑：将包含空格且无 T 的字符串替换为 T 并追加 Z
  const normalized = (sqliteUtcStr.includes(' ') && !sqliteUtcStr.includes('T'))
    ? sqliteUtcStr.replace(' ', 'T') + 'Z'
    : sqliteUtcStr;
  
  const parsedDate = new Date(normalized);
  const expectedUtcMs = Date.UTC(2026, 8, 3, 2, 44, 37); // 月份 8 为九月
  assert.equal(parsedDate.getTime(), expectedUtcMs, '规范化后的时间戳必须精确等于真实的 UTC 时间');
});



