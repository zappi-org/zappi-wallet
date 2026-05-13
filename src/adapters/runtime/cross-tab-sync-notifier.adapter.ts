import type { SyncNotifier } from '@/core/ports/driven/sync-notifier.port'
import { broadcastSync } from '@/utils/cross-tab-sync'

export class CrossTabSyncNotifierAdapter implements SyncNotifier {
  notifyBalanceChanged(): void {
    broadcastSync('balance_changed')
  }
}
