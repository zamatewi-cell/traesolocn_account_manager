import { getAccountService } from './account.service';
import { logger } from '../utils/logger';
import type { CheckinResult, BatchCheckinResult } from '../../shared/types';

export class CheckinService {
  private accounts = getAccountService();

  /**
   * Perform checkin for a single account.
   */
  async checkinSingle(accountId: number): Promise<CheckinResult> {
    const account = this.accounts.getAccountById(accountId);
    if (!account) {
      return {
        accountId,
        success: false,
        alreadyClaimed: false,
        creditsEarned: 0,
        newBalance: 0,
        message: '账号不存在',
      };
    }

    try {
      const result = await this.accounts.performCheckin(accountId);

      return {
        accountId,
        accountName: account.nickname,
        success: result.success,
        alreadyClaimed: result.alreadyCheckedIn,
        creditsEarned: result.creditsEarned,
        newBalance: account.creditsBalance + result.creditsEarned,
        message: result.message,
      };
    } catch (err) {
      logger.error(`Checkin failed for account ${accountId}:`, err);
      return {
        accountId,
        accountName: account.nickname,
        success: false,
        alreadyClaimed: false,
        creditsEarned: 0,
        newBalance: account.creditsBalance,
        message: `签到失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Perform checkin for multiple accounts with concurrency control.
   * Uses sequential processing with a delay between accounts to avoid
   * the 9074 "操作太过频繁" rate limit from the Trae API.
   */
  async checkinBatch(
    accountIds: number[],
    concurrency: number = 1
  ): Promise<BatchCheckinResult> {
    const results: CheckinResult[] = [];
    const errors: BatchCheckinResult['errors'] = [];

    let successCount = 0;
    let alreadyClaimedCount = 0;
    let failedCount = 0;

    // Process in batches with controlled concurrency
    for (let i = 0; i < accountIds.length; i += concurrency) {
      const batch = accountIds.slice(i, i + concurrency);

      const batchPromises = batch.map(async (id) => {
        try {
          const result = await this.checkinSingle(id);
          if (result.success) {
            if (result.alreadyClaimed) {
              alreadyClaimedCount++;
            } else {
              successCount++;
            }
          } else {
            failedCount++;
          }
          results.push(result);
        } catch (err) {
          failedCount++;
          const account = this.accounts.getAccountById(id);
          errors.push({
            accountId: id,
            accountName: account?.nickname,
            error: (err as Error).message,
          });
        }
      });

      await Promise.all(batchPromises);

      // Delay between batches to avoid the 9074 rate limit
      if (i + concurrency < accountIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    return {
      total: accountIds.length,
      success: successCount,
      alreadyClaimed: alreadyClaimedCount,
      failed: failedCount,
      results,
      errors,
    };
  }

  /**
   * Checkin all accounts.
   */
  async checkinAll(): Promise<BatchCheckinResult> {
    const accounts = this.accounts.getAllAccounts();
    const ids = accounts.map(a => a.id);
    return this.checkinBatch(ids);
  }
}

// Singleton
let checkinServiceInstance: CheckinService | null = null;

export function getCheckinService(): CheckinService {
  if (!checkinServiceInstance) {
    checkinServiceInstance = new CheckinService();
  }
  return checkinServiceInstance;
}
