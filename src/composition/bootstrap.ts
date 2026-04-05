/**
 * Bootstrap — Composition Root (유일한 경계 횡단 지점)
 *
 * 이 파일만 modules/, adapters/, core/services/ 전부 import 가능.
 * 모든 어댑터를 생성하고, 서비스를 조립하여 ServiceRegistry를 반환.
 *
 * 호출 시점: MainApp.tsx에서 unlock 이후 (seed + nostrPrivkey 필요)
 */

// ─── Core ───
import { createEventBus } from '@/core/events/event-bus'

// ─── Modules (bootstrap만 import 허용) ───
import { CashuModule } from '@/modules/cashu/cashu.module'
import { createCashuBackend } from '@/modules/cashu/create-cashu-backend'

// ─── Adapters ───
import { DexieTransactionRepository } from '@/adapters/storage/dexie/dexie-transaction.repository'
import { DexieContactRepository } from '@/adapters/storage/dexie/dexie-contact.repository'
import { DexiePendingOperationRepository } from '@/adapters/storage/dexie/dexie-pending-operation.repository'
import { NostrGatewayAdapter } from '@/adapters/nostr/nostr-gateway'

// ─── Composition Roots ───
import { createPaymentService } from './payment'
import { createBalanceService } from './balance'
import { createSwapService } from './swap'
import { createContactService } from './contact'
import { connectEventStoreBridge } from './event-store-bridge'

// ─── Types ───
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ServiceRegistry } from './types'

// ─── Bootstrap Input ───

export interface BootstrapDeps {
  /** Nostr 개인키 (hex) — unlock 후 사용 가능 */
  nostrPrivateKeyHex: string
}

export interface BootstrapResult extends ServiceRegistry {
  /** 초기화된 WalletModule 배열 (watchers 등에서 사용) */
  readonly modules: WalletModule[]
  /** NostrGateway 인스턴스 (다른 서비스에서 공유) */
  readonly nostrGateway: NostrGateway
  /** CashuModule 인스턴스 (module.initialize() 호출 필요) */
  readonly cashuModule: CashuModule
  /** EventBus → Store 브릿지 해제 함수 */
  readonly disconnectBridge: () => void
}

// ─── Bootstrap ───

export function createBootstrap(deps: BootstrapDeps): BootstrapResult {
  // 1. Infrastructure
  const eventBus = createEventBus()
  const txRepo = new DexieTransactionRepository()
  const contactRepo = new DexieContactRepository()
  const pendingOpRepo = new DexiePendingOperationRepository()

  // 2. Nostr Gateway
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: deps.nostrPrivateKeyHex,
  })

  // 3. Cashu Module (initialize()는 caller가 seed로 호출)
  const cashuBackend = createCashuBackend({ pendingOpRepo, txRepo })
  const cashuModule = new CashuModule(cashuBackend, nostrGateway)
  const modules: WalletModule[] = [cashuModule]

  // 4. Services (via composition roots)
  const payment = createPaymentService(modules, txRepo, eventBus)
  const balance = createBalanceService(modules)
  const swap = createSwapService(modules, txRepo, eventBus)
  const contact = createContactService(contactRepo)

  // 5. EventBus → Store bridge (balance 처리는 old bridge 제거 시 활성화)
  const disconnectBridge = connectEventStoreBridge(eventBus, { handleBalance: false })

  return {
    eventBus,
    payment,
    balance,
    swap,
    contact,
    modules,
    nostrGateway,
    cashuModule,
    disconnectBridge,
  }
}
