import { logger } from '../utils/logger';
import type { UserInfo, CreditsInfo, CheckinStatus, EntitlementPack, UsageRecordResponse } from '../../shared/types';

const DEFAULT_TIMEOUT = 20000;

// Trae API origins (based on cockpit-tools implementation)
const TRAE_ORIGIN_CN = 'https://api.trae.cn';
const TRAE_ORIGIN_CN_ICUBE = 'https://api.trae.com.cn';
const TRAE_ORIGIN_NORMAL = 'https://grow-normal.trae.ai';
const TRAE_ORIGIN_SG = 'https://growsg-normal.trae.ai';
const TRAE_ORIGIN_US = 'https://grow-normal.traeapi.us';

// API paths
const TRAE_PAY_STATUS_PATH_V1 = '/trae/api/v1/pay/ide_user_pay_status';
const TRAE_PAY_STATUS_PATH_V2 = '/trae/api/v2/pay/ide_user_pay_status';
const TRAE_ENT_USAGE_PATH_V1 = '/trae/api/v1/pay/ide_user_ent_usage';
const TRAE_ENT_USAGE_PATH_V2 = '/trae/api/v2/pay/ide_user_ent_usage';
const TRAE_CN_CURRENT_ENTITLEMENT_LIST_PATH = '/trae/api/v2/pay/user_current_entitlement_list';
const TRAE_GET_USER_INFO_PATH = '/cloudide/api/v3/trae/GetUserInfo';
const TRAE_EXCHANGE_TOKEN_PATH = '/cloudide/api/v3/trae/oauth/ExchangeToken';
const TRAE_CHECKIN_STATUS_PATH = '/trae/api/v2/ug/checkin_credits/status';
const TRAE_CHECKIN_CLAIM_PATH = '/trae/api/v2/ug/checkin_credits/claim';
const TRAE_USAGE_GROUP_BY_SESSION_PATH = '/trae/api/v1/pay/query_user_usage_group_by_session';

// Trae OAuth client IDs (from cockpit-tools)
const TRAE_AUTH_CLIENT_ID = 'ono9krqynydwx5';
const TRAE_SOLO_AUTH_CLIENT_ID = 'en1oxy7wnw8j9n';

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Generic API request with configurable auth headers.
 * Different Trae endpoints require different auth schemes (based on cockpit-tools):
 * - cloudide endpoints (GetUserInfo): Authorization: Bearer + x-cloudide-token
 * - pay endpoints (pay_status/ent_usage): Authorization: Cloud-IDE-JWT
 * - checkin endpoints: Authorization: Bearer + x-app-type + x-device-id
 */
async function apiRequest<T = any>(
  host: string,
  endpoint: string,
  token: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${host}${endpoint}`, {
      method,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': 'Trae/1.0.0 antigravity-cockpit-tools',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      // Check for auth errors
      if (response.status === 401 || response.status === 403 || data?.code === 1001) {
        throw new Error(`认证失败 (${response.status}): Token 可能已过期`);
      }
      throw new Error(`API 请求失败: ${response.status} ${response.statusText} - ${typeof data === 'string' ? data : data?.message || ''}`);
    }

    return data as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the correct API origin based on the account's region.
 * Defaults to CN origin for api.trae.cn accounts.
 */
function resolveOrigin(host: string): string {
  if (!host) return TRAE_ORIGIN_CN;
  const h = host.toLowerCase();
  if (h.includes('api.trae.cn') || h.includes('api.trae.com.cn')) {
    return TRAE_ORIGIN_CN;
  }
  if (h.includes('traeapi.us')) {
    return TRAE_ORIGIN_US;
  }
  if (h.includes('growsg') || h.includes('sg')) {
    return TRAE_ORIGIN_SG;
  }
  return TRAE_ORIGIN_NORMAL;
}

/**
 * Extract the payload root from a Trae API response.
 * Mirrors cockpit-tools usage_response_payload_root.
 */
function payloadRoot(response: any): any {
  if (!response || typeof response !== 'object') return response;
  return (
    response?.data ??
    response?.Result ??
    response?.result ??
    response?.payload ??
    response?.user_current_entitlement_list ??
    response?.ide_user_ent_usage ??
    response
  );
}

function isSuccessCode(response: any): boolean {
  if (response?.code === undefined) return true;
  return response.code === 0 || response.code === 200;
}

export class ApiService {
  /**
   * Get user info (nickname, email, avatar, etc.)
   * Uses Authorization: Bearer + x-cloudide-token headers.
   */
  async getUserInfo(token: string, host: string): Promise<UserInfo | null> {
    const origin = resolveOrigin(host);
    try {
      const response: any = await apiRequest(origin, TRAE_GET_USER_INFO_PATH, token, {
        method: 'POST',
        body: {},
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-cloudide-token': token,
        },
      });

      if (!isSuccessCode(response)) {
        logger.warn('getUserInfo returned error code:', response.code, response.message);
        return null;
      }

      const result = payloadRoot(response);
      const user = result?.user || result?.userInfo || result?.profile || result?.account || result;

      const nickname = result?.ScreenName || result?.Nickname || result?.nickname || result?.name || result?.displayName || user?.name || user?.nickname;
      const email = result?.NonPlainTextEmail || result?.Email || result?.email || user?.email || user?.nonPlainTextEmail;
      const userId = result?.UserID || result?.userId || result?.user_id || result?.uid || result?.id || user?.id;
      const avatarUrl = result?.AvatarUrl || result?.avatar_url || result?.avatarUrl || user?.avatar_url || user?.avatarUrl;

      return {
        userId: userId ? String(userId) : undefined,
        nickname: nickname || undefined,
        email: email || undefined,
        avatarUrl: avatarUrl || undefined,
      };
    } catch (err) {
      logger.error('getUserInfo failed:', err);
      return null;
    }
  }

  /**
   * Get user pay status / plan info.
   * Uses Authorization: Cloud-IDE-JWT header. POST with empty body.
   * CN prefers v2 endpoint, falls back to v1.
   */
  async getPayStatus(token: string, host: string): Promise<CreditsInfo> {
    const origin = resolveOrigin(host);
    const paths = [TRAE_PAY_STATUS_PATH_V2, TRAE_PAY_STATUS_PATH_V1];

    for (const path of paths) {
      try {
        const response: any = await apiRequest(origin, path, token, {
          method: 'POST',
          body: {},
          headers: {
            'Authorization': `Cloud-IDE-JWT ${token}`,
          },
        });

        if (!isSuccessCode(response)) {
          logger.warn('getPayStatus returned error code:', response.code, response.message);
          continue;
        }

        const result = payloadRoot(response);

        // plan_type from user_pay_identity_str
        const payStatus = result?.user_pay_identity_str || result?.user_pay_identity?.toString() || result?.plan_type || result?.payStatus || undefined;
        const detail = result?.detail || result?.Detail || {};
        const expireAt = detail?.subscription_renew_time || detail?.subscriptionRenewTime || result?.subscription_renew_time || result?.expireAt || result?.expire_time;

        return {
          balance: 0, // balance is computed from entitlements
          payStatus,
          identityStr: payStatus,
          expireAt: expireAt !== undefined && expireAt !== null ? Number(expireAt) : undefined,
          isPayFreshman: result?.is_pay_freshman ?? result?.isPayFreshman ?? false,
        };
      } catch (err) {
        logger.warn(`getPayStatus failed at ${path}:`, (err as Error).message);
      }
    }

    return { balance: 0 };
  }

  /**
   * Get the account's entitlement packs.
   * Uses Authorization: Cloud-IDE-JWT header. POST with require_usage body.
   * CN prefers v2 endpoint, falls back to v1, then to user_current_entitlement_list.
   * Returns null when EVERY endpoint failed (auth error, network error) so
   * callers can distinguish "query failed" from "verified no entitlements".
   * Treating null as [] used to blank stored credits on refresh failures.
   */
  async getEntitlements(token: string, host: string): Promise<EntitlementPack[] | null> {
    const origin = resolveOrigin(host);
    const paths = [TRAE_ENT_USAGE_PATH_V2, TRAE_ENT_USAGE_PATH_V1, TRAE_CN_CURRENT_ENTITLEMENT_LIST_PATH];
    let anyEndpointOk = false;

    for (const path of paths) {
      try {
        const response: any = await apiRequest(origin, path, token, {
          method: 'POST',
          body: { require_usage: true },
          headers: {
            'Authorization': `Cloud-IDE-JWT ${token}`,
          },
        });

        if (!isSuccessCode(response)) {
          logger.warn('getEntitlements returned error code:', response.code, response.message);
          continue;
        }
        anyEndpointOk = true;

        const result = payloadRoot(response);
        let packs: any[] = [];
        if (Array.isArray(result?.user_entitlement_pack_list)) {
          packs = result.user_entitlement_pack_list;
        } else if (Array.isArray(result?.entitlement_pack_list)) {
          packs = result.entitlement_pack_list;
        } else if (Array.isArray(result?.entitlement_packs)) {
          packs = result.entitlement_packs;
        } else if (Array.isArray(response?.user_entitlement_pack_list)) {
          packs = response.user_entitlement_pack_list;
        } else if (Array.isArray(result)) {
          packs = result;
        }

        if (packs.length > 0) {
          return packs
            .filter((pack: any) => {
              // Filter out product_type == 3 (based on cockpit)
              const pt = pack?.entitlement_base_info?.product_type ?? pack?.product_type;
              return pt !== 3;
            })
            .map((pack: any) => this.normalizeEntitlementPack(pack));
        }
      } catch (err) {
        logger.warn(`getEntitlements failed at ${path}:`, (err as Error).message);
      }
    }

    // Every endpoint failed - "unknown", not "empty".
    return anyEndpointOk ? [] : null;
  }

  /**
   * Normalize entitlement pack data from ide_user_ent_usage response.
   * Handles the real API structure where quota lives in entitlement_base_info.quota
   * and usage in usage.credits_amount (mirrors cockpit-tools).
   */
  private normalizeEntitlementPack(pack: any): EntitlementPack {
    const baseInfo = pack?.entitlement_base_info || pack?.entitlement || pack?.entitlement_info || {};
    const productExtra = baseInfo?.product_extra || {};
    const packageExtra = productExtra?.package_extra || productExtra?.subscription_extra || {};

    // Quota: prefer entitlement_quota, then baseInfo.quota, then packageExtra.quota
    const quota =
      pack?.entitlement_quota ||
      pack?.quota ||
      pack?.usage_quota ||
      pack?.quota_info ||
      baseInfo?.quota ||
      packageExtra?.quota;

    // Usage: prefer usage.credits_amount (real API), then quota.used_quota
    const usage = pack?.usage || {};
    const totalQuota =
      quota?.total_quota ??
      quota?.totalQuota ??
      quota?.total ??
      quota?.credits_limit ??
      quota?.creditsLimit ??
      0;
    const usedQuota =
      usage?.credits_amount ??
      usage?.creditsAmount ??
      usage?.used ??
      quota?.used_quota ??
      quota?.usedQuota ??
      quota?.used ??
      0;

    const packName =
      pack?.entitlement_pack_name ||
      pack?.name ||
      pack?.display_desc ||
      pack?.group_name ||
      packageExtra?.package_name ||
      packageExtra?.name ||
      baseInfo?.entitlement_pack_name ||
      baseInfo?.name ||
      '权益包';

    return {
      entitlement_pack_id: pack?.entitlement_pack_id || pack?.pack_id || pack?.id || baseInfo?.entitlement_pack_id || String(Math.random()),
      entitlement_pack_name: packName,
      entitlement_pack_desc: pack?.entitlement_pack_desc || pack?.desc || baseInfo?.entitlement_pack_desc || baseInfo?.desc || '',
      product_id: pack?.product_id || pack?.productId || baseInfo?.product_id || '',
      start_time: pack?.start_time || pack?.startTime || baseInfo?.start_time || 0,
      expire_time: pack?.expire_time || pack?.expireTime || baseInfo?.end_time || baseInfo?.expire_time || 0,
      status: pack?.status ?? pack?.Status ?? 0,
      entitlement: {
        entitlement_id: baseInfo?.entitlement_id || baseInfo?.id || '',
        entitlement_key: baseInfo?.entitlement_key || baseInfo?.key || '',
        entitlement_name: baseInfo?.entitlement_name || baseInfo?.name || '',
        entitlement_desc: baseInfo?.entitlement_desc || baseInfo?.desc || '',
      },
      entitlement_quota: {
        total_quota: totalQuota,
        used_quota: usedQuota,
        unit: quota?.unit || '次',
      },
    };
  }

  /**
   * Get checkin status.
   * Uses Authorization: Cloud-IDE-JWT + x-app-type + x-device-id headers.
   * NOTE: The checkin API for CN accounts requires Cloud-IDE-JWT auth (Bearer returns code 1001).
   * URL includes ?did={deviceId} query param.
   *
   * Returns null when the query FAILS (auth error, network error, unexpected
   * response). Callers must treat null as "unknown" - the previous all-false
   * fallback object was indistinguishable from "not checked in", which reset
   * is_checked_in on every failed refresh and made the account look like it
   * still needed a (pointless, device-slot-burning) claim.
   */
  async getCheckinStatus(token: string, host: string, deviceId?: string): Promise<CheckinStatus | null> {
    const origin = resolveOrigin(host);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Cloud-IDE-JWT ${token}`,
        'x-app-type': 'trae',
        'Origin': 'https://www.trae.cn',
        'Referer': 'https://www.trae.cn/',
      };
      let url = `${origin}${TRAE_CHECKIN_STATUS_PATH}`;
      if (deviceId) {
        headers['x-device-id'] = deviceId;
        url += `?did=${encodeURIComponent(deviceId)}`;
      }

      const response: any = await this.rawGet(url, headers);

      const result = payloadRoot(response);
      const code = Number(response?.code ?? result?.code ?? 0);
      logger.info(
        `getCheckinStatus code=${code} raw=${JSON.stringify(response ?? result).slice(0, 300)}`
      );
      // code 0 = success, code 1001 = auth failure (token invalid/expired)
      if (code !== 0 && code !== 200) {
        logger.warn('getCheckinStatus failed, code:', code, response?.message);
        return null;
      }
      const checkedIn = !!(result?.checked_in ?? result?.checkedIn ?? false);
      const credits = Number(result?.credits ?? result?.credit ?? 0);
      const enable = !!(result?.enable ?? result?.can_checkin ?? result?.canCheckin ?? false);

      return {
        checkedIn,
        canCheckin: enable && !checkedIn,
        credits,
        enable,
      };
    } catch (err) {
      logger.error('getCheckinStatus failed:', err);
      return null;
    }
  }

  private async rawGet(url: string, headers: Record<string, string>): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'User-Agent': 'Trae/1.0.0 antigravity-cockpit-tools',
          ...headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (!response.ok) {
        throw new Error(`签到状态请求失败: ${response.status} ${response.statusText}`);
      }
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Claim daily checkin.
   * Uses Authorization: Cloud-IDE-JWT + x-app-type + x-device-id headers.
   * NOTE: The checkin API for CN accounts requires Cloud-IDE-JWT auth (Bearer returns code 1001).
   */
  async claimCheckin(token: string, host: string, deviceId?: string): Promise<{
    success: boolean;
    alreadyClaimed: boolean;
    creditsEarned: number;
    newBalance: number;
    message?: string;
    isDeviceLimit?: boolean;
    isRateLimit?: boolean;
    code?: number;
  }> {
    const origin = resolveOrigin(host);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Cloud-IDE-JWT ${token}`,
        'x-app-type': 'trae',
        'Origin': 'https://www.trae.cn',
        'Referer': 'https://www.trae.cn/',
      };
      if (deviceId) {
        headers['x-device-id'] = deviceId;
      }

      const response: any = await apiRequest(origin, TRAE_CHECKIN_CLAIM_PATH, token, {
        method: 'POST',
        body: {},
        headers,
      });

      const result = payloadRoot(response);
      const code = Number(response?.code ?? result?.code ?? 0);
      const message = String(response?.message ?? result?.message ?? '');
      // Log the raw response so failures on remote machines can be diagnosed
      // from %APPDATA%\trae-account-manager\app.log without a debugger.
      logger.info(
        `claimCheckin code=${code} msg="${message.slice(0, 120)}" raw=${JSON.stringify(response ?? result).slice(0, 300)}`
      );

      // code 9074 = rate limited ("操作太过频繁啦，请稍后尝试"); also returned for
      // device IDs the server does not recognize (e.g. the random fallback ID
      // used when no local Trae session has ever registered this machine).
      if (code === 9074) {
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

      // 9095 is device-scoped, not account-scoped. Confirm the current account
      // before classifying it: a repeated request by an account that really did
      // check in is "already claimed", while an unchecked account must remain a
      // failure because another account consumed this device's daily slot.
      if (code === 9095) {
        const confirmed = await this.getCheckinStatus(token, host, deviceId);
        if (confirmed?.checkedIn) {
          return {
            success: true,
            alreadyClaimed: true,
            creditsEarned: 0,
            newBalance: 0,
          };
        }
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

      // code 0 = success
      let alreadyClaimed = code !== 0 && code !== 200 && (
        message.includes('already') ||
        message.includes('已签到') ||
        result?.checked_in ||
        result?.checkedIn
      );
      let success = code === 0 || code === 200;

      // A message containing "已签到" is not sufficient: device-limit errors
      // use the same wording. Confirm that THIS account is checked in before
      // reporting an already-claimed success.
      if (!success && alreadyClaimed) {
        const confirmed = await this.getCheckinStatus(token, host, deviceId);
        alreadyClaimed = !!confirmed?.checkedIn;
        success = alreadyClaimed;
      }

      // The claim response itself does not include the earned credits, so
      // re-query the status after a successful claim to get the accurate reward.
      // Never invent a reward when the server omitted it. A guessed 200 used
      // to corrupt the local balance whenever the confirmation query failed.
      let creditsEarned = Number(result?.credits ?? result?.credits_earned ?? 0);
      let newBalance = result?.new_balance || result?.balance || 0;
      if (success && !alreadyClaimed) {
        try {
          const afterStatus = await this.getCheckinStatus(token, host, deviceId);
          if (afterStatus && afterStatus.credits > 0) {
            creditsEarned = afterStatus.credits;
          }
        } catch {
          // Ignore - keep the reward returned by the claim response.
        }
      }

      return {
        success,
        alreadyClaimed,
        creditsEarned,
        newBalance,
        message: success ? undefined : (message || `签到接口返回错误码 ${code}`),
      };
    } catch (err) {
      logger.error('claimCheckin failed:', err);
      throw new Error(`签到失败: ${(err as Error).message}`);
    }
  }

  /**
   * Get detailed usage records grouped by session.
   * Uses Authorization: Cloud-IDE-JWT header.
   * NOTE: start_time/end_time must be in SECONDS (ms returns code 9019).
   * Credits billing accounts require usage_type: [7]; subscription accounts must omit it.
   * Try credits mode first, fall back to omitted usage_type when it returns no data.
   */
  async getUsageRecords(
    token: string,
    host: string,
    options?: { startTime?: number; endTime?: number; pageSize?: number; pageNum?: number }
  ): Promise<UsageRecordResponse> {
    const origin = resolveOrigin(host);
    const nowSec = Math.floor(Date.now() / 1000);
    const startTime = options?.startTime ?? nowSec - 30 * 24 * 3600; // default: last 30 days
    const endTime = options?.endTime ?? nowSec;
    const pageSize = options?.pageSize ?? 20;
    const pageNum = options?.pageNum ?? 1;

    const baseBody = {
      start_time: startTime,
      end_time: endTime,
      page_size: pageSize,
      page_num: pageNum,
      Request: {},
    };
    const attempts: any[] = [
      { ...baseBody, usage_type: [7] },
      baseBody,
    ];

    for (const body of attempts) {
      try {
        const response: any = await apiRequest(origin, TRAE_USAGE_GROUP_BY_SESSION_PATH, token, {
          method: 'POST',
          body,
          headers: {
            'Authorization': `Cloud-IDE-JWT ${token}`,
          },
        });

        const result = payloadRoot(response);
        const total = Number(result?.total ?? response?.total ?? 0);
        const sessions = result?.user_usage_group_by_sessions ?? response?.user_usage_group_by_sessions ?? [];

        // Credits attempt returned nothing -> try the subscription-mode attempt
        if (total === 0 && Array.isArray(body.usage_type)) continue;

        return {
          total,
          user_usage_group_by_sessions: Array.isArray(sessions) ? sessions.map((s: any) => this.normalizeUsageRecord(s)) : [],
        };
      } catch (err) {
        logger.error('getUsageRecords failed:', err);
        if (Array.isArray(body.usage_type)) continue;
        return { total: 0, user_usage_group_by_sessions: [] };
      }
    }

    return { total: 0, user_usage_group_by_sessions: [] };
  }

  /**
   * Normalize a usage session record from the API.
   * Handles both the credits billing format (flat session records with
   * usage_time/model_name/product_type_list/credits_float/user_input_preview)
   * and the legacy grouped format defensively.
   */
  private normalizeUsageRecord(session: any): UsageRecordResponse['user_usage_group_by_sessions'][number] {
    const usageList = session?.usage_list ?? session?.usage ?? session?.records ?? [];
    const first = Array.isArray(usageList) && usageList.length > 0 ? usageList[0] : session;

    const usageTime = Number(session?.usage_time ?? first?.usage_time ?? 0);
    const startTime = session?.session_start_time ?? session?.start_time ?? session?.startTime ?? usageTime;
    const endTime = session?.session_end_time ?? session?.end_time ?? session?.endTime ?? startTime;

    const productTypes = session?.product_type_list ?? first?.product_type_list ?? [];
    const productName = Array.isArray(productTypes)
      ? productTypes.map((t: number) => this.productTypeName(t)).filter(Boolean).join('、')
      : '';

    const extraInfo = session?.extra_info ?? first?.extra_info ?? {};
    const promptTokens = Number(extraInfo?.input_token ?? session?.prompt_tokens ?? first?.prompt_tokens ?? 0);
    const completionTokens = Number(extraInfo?.output_token ?? session?.completion_tokens ?? first?.completion_tokens ?? 0);

    return {
      session_id: String(session?.session_id ?? session?.id ?? session?.sessionId ?? ''),
      session_start_time: Number(startTime) || 0,
      session_end_time: Number(endTime) || 0,
      model_name: String(first?.model_name ?? first?.model ?? first?.modelName ?? session?.model_name ?? ''),
      product_name: String(productName || first?.product_name || first?.product || first?.productName || session?.product_name || ''),
      credits_consumed: Number(first?.credits_float ?? first?.credits_consumed ?? first?.credits ?? first?.consume_credits ?? first?.credit ?? 0),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      usage_desc: String(session?.user_input_preview ?? first?.user_input_preview ?? ''),
    };
  }

  /**
   * Map the product_type_list (ch enum) value to a display name.
   */
  private productTypeName(type: number): string {
    const names: Record<number, string> = {
      0: 'Free',
      1: 'Pro',
      2: 'Package',
      3: 'PromoCode',
      4: 'ProPlus',
      5: 'ProPlusPack',
      6: 'Ultra',
      7: 'PayGo',
      8: 'Lite',
      9: 'SoloInvite',
      100: 'Express',
    };
    return names[type] ?? '';
  }

  /**
   * Validate a token by making API calls.
   */
  async validateToken(token: string, host: string): Promise<{ valid: boolean; userInfo?: UserInfo; payStatus?: CreditsInfo; entitlements?: EntitlementPack[] }> {
    try {
      const [userInfo, entitlementResult, payStatus] = await Promise.all([
        this.getUserInfo(token, host).catch(() => null),
        this.getEntitlements(token, host).catch(() => null),
        this.getPayStatus(token, host).catch((): CreditsInfo => ({ balance: 0 })),
      ]);
      const entitlements: EntitlementPack[] = entitlementResult || [];

      const valid = entitlements.length > 0 || payStatus.identityStr !== undefined || userInfo !== null;
      return { valid, userInfo: userInfo || undefined, payStatus: { ...payStatus, entitlementPacks: entitlements }, entitlements };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Refresh access token using refresh token.
   * Uses the ExchangeToken endpoint with the correct ClientID (from cockpit-tools).
   * The request MUST include the Authorization: Bearer header and the current access
   * token in the body, otherwise the server returns 400 "refresh token is not matched
   * to the client".
   * Returns the new access token, the rotated refresh token, and the new expiry.
   */
  async refreshToken(refreshToken: string, host: string, accessToken?: string): Promise<{ token: string; refreshToken: string; tokenExpiredAt: string | null } | null> {
    const origin = resolveOrigin(host);
    // Trae CN / Trae use ono9krqynydwx5; TRAE SOLO CN uses en1oxy7wnw8j9n.
    // Try the SOLO client id first (most common for CN users), then the regular one.
    const clientIds = [TRAE_SOLO_AUTH_CLIENT_ID, TRAE_AUTH_CLIENT_ID];
    const currentToken = accessToken || '';

    for (const clientId of clientIds) {
      try {
        const response: any = await apiRequest(origin, TRAE_EXCHANGE_TOKEN_PATH, currentToken, {
          method: 'POST',
          body: {
            ClientID: clientId,
            RefreshToken: refreshToken,
            ClientSecret: '-',
            UserID: '',
            refreshToken,
            refresh_token: refreshToken,
            token: currentToken,
          },
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'x-cloudide-token': currentToken,
          },
        });

        const result = payloadRoot(response);
        const newToken = result?.Token || result?.token || result?.accessToken || result?.AccessToken;
        if (newToken) {
          const newRefreshToken = result?.RefreshToken || result?.refreshToken || refreshToken;
          const tokenExpiredAt = this.decodeJwtExpiry(newToken);
          logger.info(`Token refreshed successfully (ClientID=${clientId})`);
          return { token: newToken, refreshToken: newRefreshToken, tokenExpiredAt };
        }
      } catch (e) {
        logger.warn(`Token refresh with ClientID ${clientId} failed:`, (e as Error).message);
      }
    }

    return null;
  }

  /**
   * Decode the expiry timestamp from a JWT access token.
   * Returns an ISO string, or null if it cannot be decoded.
   */
  private decodeJwtExpiry(token: string): string | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      const exp = payload?.exp;
      if (typeof exp === 'number' && exp > 0) {
        return new Date(exp * 1000).toISOString();
      }
    } catch {
      // ignore
    }
    return null;
  }
}

// Singleton
let apiServiceInstance: ApiService | null = null;

export function getApiService(): ApiService {
  if (!apiServiceInstance) {
    apiServiceInstance = new ApiService();
  }
  return apiServiceInstance;
}
