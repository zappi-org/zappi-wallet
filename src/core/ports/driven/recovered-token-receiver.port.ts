import type { Amount } from '@/core/domain/amount'

export type RecoveredTokenReceiveResult =
  | { success: true; amount: Amount }
  | { success: false; error?: string }

export interface RecoveredTokenReceiver {
  receiveRecoveredToken(token: string): Promise<RecoveredTokenReceiveResult>
}
