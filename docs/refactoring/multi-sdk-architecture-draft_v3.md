# Multi-SDK 아키텍처 설계 초안 v3

## 핵심 문제

1. `WalletBackendPort`가 Cashu 전용 (`mintQuote`, `meltQuote`) — 다른 SDK에 맞지 않음
2. 하나의 seed에서 module별 derivation path로 분기
3. 사용자가 module을 활성/비활성 선택 가능해야 함

> **비화폐 도메인(기프티콘, 멤버십, 티켓)은 이 설계 범위 밖이다.**
> `TokenVault` + `cashu-ts` 유틸리티만으로 동작하며 화폐 아키텍처와 독립. 별도 문서에서 다룬다.

---

## 1. 전체 구조 (헥사고널 관점)

```
          Driving (주도) Adapters              Driven (피주도) Adapters
          UI가 앱을 구동                        앱이 외부를 구동
          ─────────────────                    ─────────────────

          ┌─────────┐                          ┌─────────────────┐
          │ React UI│                          │  CashuModule    │
          │ Hooks   │                          │   (Coco SDK)    │
          └────┬────┘                          ├─────────────────┤
               │ uses                          │  FedimintModule │
               │                               │   (Fedi SDK)    │
    ┌──────────▼────────────────┐              ├─────────────────┤
    │        core/ports/        │              │  OnchainModule  │
    │  ┌──────────────────────┐ │ implements   │   (bitcoin lib) │
    │  │ UseCasePorts         │◄├──────────────┤                 │
    │  │  PaymentUseCase      │ │              │  SwapProviders  │
    │  │  NfcCardUseCase      │ │              │   (Boltz 등)    │
    │  │  SwapUseCase         │ │              └─────────────────┘
    │  ├──────────────────────┤ │
    │  │ Driven Ports         │ │
    │  │  WalletModule        │ │
    │  │  PaymentMethodAdapter│ │
    │  │  SwapProvider        │ │
    │  └──────────────────────┘ │
    │                           │
    │  core/domain/             │
    │   Amount, Transaction     │
    │                           │
    │  services/ (application)  │
    │   PaymentService          │
    │   BalanceAggregator       │
    └───────────────────────────┘
           안쪽 (헥사곤)

  비화폐 (별도 설계, 이 문서 범위 밖)
  GiftCard / Membership / Ticket → TokenVault (자체 DB, Module 무관)
```

### 의존 방향 규칙

```
UI (driving adapter) → UseCasePort → services → Driven Port ← modules (driven adapter)
```

- **안쪽은 바깥을 모른다.** `core/`, `services/`는 `modules/`, `ui/`를 import하지 않는다.
- **바깥은 안쪽을 구현한다.** `modules/`는 `core/ports/` 인터페이스를 implements.
- **UI는 Port를 통해 앱을 호출한다.** hooks가 services를 직접 import하지 않고 UseCasePort를 통해 접근.
- **조립은 bootstrap/AppManager에서.** 유일하게 모든 것을 알고 연결하는 장소.

---

## 2. Port 인터페이스

### Driving Ports (UI → 앱)

UI가 비즈니스 로직을 호출하는 인터페이스. hooks는 이 Port만 알면 된다.

```typescript
interface PaymentUseCase {
  // 1. 출금 소스 선택 — 사용자가 지갑(mint/account) 먼저 고른다
  getAccounts(): Promise<ModuleBalance[]>
  getMethodsForAccount(accountId: string): PaymentMethodAdapter[]

  // 2. 송금 — 소스 + 방법이 이미 결정된 상태
  send(params: {
    accountId: string         // 어떤 지갑에서 (mint URL, federation ID 등)
    adapterId: string         // 어떤 방법으로 (cashu:lightning, fedi:ecash 등)
    destination: string       // 어디로 (lnbc1..., cashuA..., bc1... 등)
    amount: Amount
    memo?: string
  }): Promise<SendResult>

  // 3. 수신 — 어떤 지갑으로, 어떤 방법으로
  receive(params: {
    accountId: string
    adapterId: string
    amount: Amount
    description?: string
  }): Promise<ReceiveRequest>

  estimateFee(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
  }): Promise<FeeEstimate>

  // 입력 파싱 (destination format 검증용, routing 아님)
  parseInput(input: string): ParsedInput | null

  recoverAll(): Promise<RecoveryReport[]>
}

interface NfcCardUseCase {
  writeToCard(mintUrl: string, amount: Amount): Promise<NfcWriteResult>
  readFromCard(): Promise<NfcReadResult>
  getCardBalance(): Promise<Amount>
  recoverExpiredCard(backupId: string): Promise<RecoverResult>
}

interface SwapUseCase {
  getAvailableSwaps(): SwapPair[]
  estimateSwap(params: SwapParams): Promise<SwapEstimate>
  executeSwap(params: SwapParams): Promise<SwapResult>
}

interface BalanceUseCase {
  getTotal(): Promise<Amount>
  getByModule(): Promise<ModuleBalance[]>
}
```

### Driven Ports (앱 → 외부)

앱이 외부 시스템(SDK, 스왑 서비스)에 요청하는 인터페이스.

### WalletModule

```typescript
interface WalletModule {
  readonly id: string                    // 'cashu' | 'fedimint' | 'onchain'
  readonly displayName: string

  initialize(seed: Uint8Array, derivationPath: string): Promise<void>
  dispose(): Promise<void>
  isEnabled(): boolean

  getPaymentAdapters(): PaymentMethodAdapter[]
  getCapabilities(): ModuleCapability[]  // NFC 등 module-specific 능력
  getBalance(): Promise<ModuleBalance>
  on(event: string, handler: (...args: any[]) => void): () => void
}

interface ModuleCapability {
  id: string           // 'nfc-card'
  operations: string[] // ['write', 'read', 'backup', 'recover']
}

interface ModuleBalance {
  moduleId: string
  accounts: { id: string; label: string; amount: Amount }[]
  total: Amount
}
```

### PaymentMethodAdapter

```typescript
interface PaymentMethodAdapter {
  readonly id: string              // 'cashu:lightning' | 'fedi:ecash'
  readonly moduleId: string        // 소속 module
  readonly supportedUnits: string[]
  readonly capabilities: { canSend: boolean; canReceive: boolean; canEstimateFee: boolean }

  parseInput(input: string): ParsedInput | null    // destination format 검증
  createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest>
  estimateFee(params: SendParams): Promise<FeeEstimate>
  prepareSend(params: SendParams): Promise<PreparedPayment>
  executeSend(preparedId: string): Promise<ExecutingPayment>
  cancelPrepared(preparedId: string): Promise<void>
  reclaimFailed(operationId: string): Promise<void>
  recoverPending(): Promise<RecoveryReport>
}
```

### SwapProvider

```typescript
interface SwapProvider {
  readonly id: string                // 'boltz' | 'cashu-native'
  readonly supportedPairs: SwapPair[]
  estimateSwap(params: SwapParams): Promise<SwapEstimate>
  executeSwap(params: SwapParams): Promise<SwapResult>
}

interface SwapPair {
  from: { moduleId: string; method: string }
  to: { moduleId: string; method: string }
}
```

---

## 3. 화폐 서비스

### PaymentService (범용)

사용자 선택 흐름: **지갑(account) 선택 → 사용 가능한 method 확인 → 송수신 실행**.

```typescript
class PaymentService implements PaymentUseCase {
  constructor(private modules: WalletModule[]) {}

  // 1. 사용자에게 지갑 목록 제공
  async getAccounts(): Promise<ModuleBalance[]> {
    return Promise.all(this.modules.map(m => m.getBalance()))
  }

  // 2. 선택된 지갑에서 쓸 수 있는 method 목록
  getMethodsForAccount(accountId: string): PaymentMethodAdapter[] {
    // accountId(mint URL 등)가 속한 module을 찾고, 그 module의 adapter 반환
    const module = this.findModuleForAccount(accountId)
    return module.getPaymentAdapters()
  }

  // 3. 실행 — 소스와 방법이 이미 결정됨
  async send(params) {
    const module = this.findModuleForAccount(params.accountId)
    const adapter = module.getPaymentAdapters().find(a => a.id === params.adapterId)!
    const prepared = await adapter.prepareSend(params)
    return adapter.executeSend(prepared.id)
  }
}
```

`ModuleRouter`(자동 선택)는 없다. **사용자가 직접 소스와 방법을 고른다.** `parseInput()`은 destination format 검증 용도로만 남는다.

### NfcCardService

NFC 카드 = **오프라인 ecash 저장 도구**. 실제 proof 이동이므로 잔액 영향 있음. mint 기능과 무관 — 어떤 mint의 토큰이든 카드에 저장 가능.

NfcCardService는 `NfcCardUseCase` Port를 구현하고, Driven Port인 `WalletModule`을 통해 토큰을 생성/수령한다. 내부에서 Cashu 전용 기능(ecash token 생성)이 필요하므로 bootstrap에서 CashuModule을 주입받지만, 서비스 코드 자체는 `WalletModule` 인터페이스를 통해 접근한다.

```typescript
// NfcCardUseCase 구현
class NfcCardService implements NfcCardUseCase {
  constructor(private walletModule: WalletModule) {}  // Port로 주입

  async writeToCard(mintUrl: string, amount: Amount) {
    // walletModule의 adapter를 통해 token 생성 (ecash send)
    const adapter = this.walletModule.getPaymentAdapters()
      .find(a => a.id.endsWith(':ecash'))!
    const prepared = await adapter.prepareSend({ destination: 'nfc-card', amount, mintUrl })
    // NFC write...
  }
}

// bootstrap에서 조립 시 CashuModule 주입 (서비스는 구체 타입을 모름)
const nfcCardService = new NfcCardService(cashuModule)  // WalletModule로 받음
```

### SwapService (범용)

Module의 기존 LN adapter를 조합해 cross-layer 이동. LN이 아닌 경로(on-chain)로 자금 이동 시 사용.

```
Module ←→ Lightning ←→ Boltz ←→ On-chain
```

향후 Cashu에 on-chain 기능 추가되면 `CashuOnchainSwapProvider` 등록. Boltz 불필요 시 제거. 인터페이스 동일.

---

## 4. 결정 사항

| # | 질문 | 결정 |
|---|------|------|
| 1 | Module 활성/비활성 | Settings에서 사용자 결정 |
| 2 | Cross-module swap | SwapService + SwapProvider (Boltz 등) |
| 3 | Seed / derivation | 단일 seed, module별 derivation path |
| 4 | Default module | AppManager init 시 설정. 사용자가 소스 미선택 시 기본 지갑으로 사용 |
| 5 | 잔액 표시 | BalanceAggregator: Module별 + 통합 |
| 6 | Adapter ID | `moduleId:method` (e.g., `cashu:lightning`) |
| 7 | NFC/기프티콘/멤버십 | NFC=화폐(CashuModule), 기프티콘/멤버십/티켓=비화폐(TokenVault, 별도) |
| 8 | UI 진입점 | 하단 네비 (홈: 잔액+송수신, 카드: NFC+비화폐서비스, 설정: module on/off) |
| 9 | Module 간 의존 | 서비스는 항상 Port(`WalletModule`) 경유. bootstrap에서 구체 module 주입 |
| 10 | Capability 동적 등록 | Module 활성/비활성에 따라 자동 (Cashu off → NFC 사라짐) |

### Derivation Paths

```
Cashu:    m/129372'/0'     (NIP-06 호환)
Fedimint: m/129372'/1'
On-chain: m/84'/0'/0'     (BIP-84 Native SegWit)
```

---

## 5. 디렉터리 구조

```
src/
├── core/                              # 순수 도메인 (외부 의존 0)
│   ├── domain/                        # Amount, Transaction
│   ├── ports/
│   │   ├── driving/                   # UI → 앱 (UseCase: Payment, NfcCard, Swap, Balance)
│   │   └── driven/                    # 앱 → 외부 (WalletModule, PaymentMethodAdapter, SwapProvider)
│   ├── events/                        # EventBus, DomainEvent 타입
│   └── errors/
│
├── modules/                           # WalletModule 구현체
│   ├── cashu/
│   │   ├── cashu.module.ts
│   │   ├── internal/                  # Coco SDK (바깥에서 import 금지)
│   │   ├── adapters/                  # cashu:lightning, cashu:ecash
│   │   └── capabilities/             # nfc-card.ops.ts
│   ├── fedimint/
│   │   ├── fedimint.module.ts
│   │   ├── internal/                  # Fedimint SDK
│   │   └── adapters/                  # fedi:lightning, fedi:ecash
│   └── onchain/
│       ├── onchain.module.ts
│       ├── internal/
│       └── adapters/                  # onchain:btc
│
├── services/                          # 화폐 서비스
│   ├── payment/                       # PaymentService, BalanceAggregator
│   ├── swap/                          # SwapService + providers/
│   └── nfc-card/                      # NfcCardService (CashuModule 직접 참조)
│
├── vault/                             # 비화폐 (별도 경로, Module 무관)
│   ├── token-vault.ts
│   ├── cashu-codec.ts                 # cashu-ts 유틸리티 (Coco 무관)
│   ├── gift-card/
│   ├── membership/
│   └── ticket/
│
├── app/                               # AppManager, ModuleRegistry, SeedManager
├── store/                             # Zustand
├── hooks/                             # React ↔ Services
├── ui/                                # 화면, 컴포넌트
└── bootstrap.ts
```

**의존 규칙:**
- `core/` → 아무것도 import하지 않음 (순수)
- `services/` → `core/` 만 import (Port, Domain 타입)
- `modules/` → `core/` 만 import (Port를 implements)
- `modules/*/internal/` → 해당 module 내부에서만 import
- `hooks/` → `core/ports/`의 UseCase Port만 import
- `ui/` → `hooks/`와 `store/`만 import
- `vault/` → `modules/`, `services/` import 금지 (완전 독립)
- `app/`, `bootstrap.ts` → 유일하게 모든 것을 import하여 조립

---

## 6. 기존 hexagonal 문서 대비 변경점

| 기존 | 변경 |
|------|------|
| `WalletBackendPort` (범용) | **삭제.** Module `internal/`로 격하 |
| Driving Port 없음 (hooks→services 직접) | **UseCasePort 추가** (Payment, NfcCard, Swap, Balance) |
| NfcCardService→CashuModule 직접 참조 | **WalletModule Port 경유**, bootstrap에서 주입 |
| 단일 backend | **Module 복수 활성**, 사용자 선택 |
| 단일 seed | 단일 seed + **Module별 derivation path** |
| bootstrap 직접 조립 | **AppManager** settings 기반 동적 조립 |
| BalanceService (단일) | **BalanceAggregator** (전 Module 합산) |
| Payment만 고려 | 화폐(Payment, NFC, Swap) + 비화폐(TokenVault) **분리** |

### 화폐 / 비화폐 경계

| | 화폐 (이 문서) | 비화폐 (별도) |
|---|---|---|
| **예시** | 송수신, NFC 카드, 스왑 | 기프티콘, 멤버십, 티켓 |
| **잔액 영향** | 있음 | 없음 |
| **의존** | WalletModule, Adapter, Orchestrator | TokenVault, cashu-ts |
| **저장소** | Module 내부 DB | vault/ 자체 DB |
