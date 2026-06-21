# Zappi Wallet 헥사고널 아키텍처 리팩터링 가이드 v2

## 목차

| Part | 내용 |
|------|------|
| [**1. 왜 헥사고널인가**](#1-왜-헥사고널인가) | 현재 구조 문제점. 변경 시 파급 범위 비교 |
| [**2. 핵심 개념**](#2-핵심-개념) | 안쪽/바깥, Driving/Driven, 헥사곤의 구조 |
| [**3. 핵심 용어**](#3-핵심-용어) | Port, Adapter, Domain, Module, UseCase, Persistence, Error, EventBus, Store |
| [**4. 의존성 규칙**](#4-의존성-규칙) | 디렉터리별 import 규칙, 의존 방향 |
| [**5. 도메인 추가 가이드**](#5-도메인-추가-가이드) | 새 Module, Adapter, Service 추가 시 체크리스트 |

> 각 Part의 구체적 코드 예시는 별도 문서(`hexagonal-code-examples.md`)에서 다룬다.

---

## 1. 왜 헥사고널인가

### 현재 구조의 문제

```
SendFlow.tsx → coco/cashuService.ts → @cashu/coco-core
SendConfirmStep.tsx → coco/cashuService.ts
routing/execute-route.ts → coco/cashuService.ts
routing/estimate-fee.ts → coco/cashuService.ts
payment.service.ts → coco/cashuService.ts
```

`cashuService.ts`가 허브. UI부터 라우팅, 서비스까지 27개 함수를 직접 import한다.

### 변경 시 파급 범위

| 시나리오 | 현재 | 리팩터 후 |
|---------|------|----------|
| Coco SDK 시그니처 변경 | cashuService + routing + payment service + UI = **5+ 파일** | `modules/cashu/internal/` = **1 파일** |
| bolt12 프로토콜 추가 | cashuService + routing + payment service + UI step + types = **8 파일** | `modules/cashu/adapters/` 내 codec 추가 = **1~2 파일** |
| Fedimint Module 추가 | 기존 코드 전체에 분기문 = **산발적** | `modules/fedimint/` 신규 + bootstrap 등록 = **기존 코드 0 수정** |
| 비화폐 서비스(기프티콘) 추가 | 어디에 넣을지 불명확 | `vault/gift-card/` 신규 = **화폐 코드 0 수정** |

**핵심:** 변경의 영향 범위를 해당 영역 안에 가둔다.

---

## 2. 핵심 개념

### "안쪽은 바깥을 모른다"

이 한 문장이 헥사고널 아키텍처의 전부다.

```
바깥 (외부 세계)                안쪽 (비즈니스 로직)
─────────────                  ────────────────
Coco SDK, Fedimint SDK         "이 지갑에서 1000 sat를 Lightning으로 보내라"
IndexedDB, Nostr relay         "잔액을 조회하라"
React UI, NFC 하드웨어          "NFC 카드에 토큰을 쓰라"
bolt11 디코더, Boltz API
```

안쪽은 "Coco"를 모른다. "React"를 모른다. "bolt11"을 모른다.
안쪽은 오직 **"무엇을 해야 하는가"**만 안다.

### Driving과 Driven

바깥은 두 종류다:

**Driving (주도):** 바깥이 안쪽을 호출. "사용자가 보내기 버튼을 눌렀다."
- React UI, hooks (사용자 주도)
- Watchers, Schedulers (이벤트/시간 주도)
- 테스트 러너

**Driven (피주도):** 안쪽이 바깥에 요청. "이 토큰을 생성해라."
- Coco SDK, Fedimint SDK
- IndexedDB, Nostr relay
- Boltz swap API

```
Driving Adapter          헥사곤 (안쪽)              Driven Adapter
───────────              ──────────               ──────────

 React UI  ──→                                                ←── CashuModule
 Hooks     ──→  UseCasePort  ──→  Service  ──→  DrivenPort   ←── FedimintModule
 Watchers  ──→                                                ←── SwapProvider
                                                              ←── Storage (Dexie)
```

**화살표 방향:** Driving은 안쪽을 호출(`→`). Driven은 안쪽이 정의한 Port를 구현(`←`).

Watchers는 hooks와 동급의 Driving Adapter다. 트리거 소스만 다를 뿐, **같은 UseCase Port를 호출한다.**
- 앱 포그라운드 복귀 → `paymentUseCase.recoverAll()`
- 네트워크 복구 → `paymentUseCase.recoverAll()`
- Coco 이벤트 수신 → `EventBus.emit()` → 내부 반응

Watcher 안에 비즈니스 로직 없음. "언제 호출할지"만 결정.

### Zappi에서의 헥사곤 — 바깥과 안쪽

```
  Driving Adapters                                       Driven Adapters
  (바깥이 안쪽을 호출)                                     (안쪽이 정의, 바깥이 구현)

  ┌──────────┐                                         ┌───────────────┐
  │ React UI │                                         │ CashuModule   │
  │ Hooks    │                                         │ FedimintModule│
  ├──────────┤                                         │ OnchainModule │
  │ Watchers │                                         │ SwapProviders │
  │(lifecycle│                                         ├───────────────┤
  │ network) │                                         │ Storage       │
  └────┬─────┘                                         │  Dexie/SQLite │
       │ calls                                         └───────┬───────┘
  ┌────▼────────────────────────────────────────┐              │
  │                 안쪽 (헥사곤)                  │              │
  │                                              │              │
  │  ports/driving/  (UseCase)                   │              │
  │    PaymentUseCase                            │              │
  │    NfcCardUseCase                            │              │
  │    SwapUseCase                               │              │
  │    BalanceUseCase                            │              │
  │         ▲ implements                         │              │
  │         │                                    │              │
  │  services/  (application)                    │              │
  │    PaymentService ───────────────────────────┼→ ports/driven/ ◄──┘
  │    BalanceAggregator                         │    WalletModule  implements
  │         │                                    │    PaymentMethodAdapter
  │         │ uses                               │    SwapProvider
  │         ▼                                    │    TransactionRepo
  │  domain/                                     │    SettingsRepo
  │    Amount, Transaction                       │    ContactRepo
  │  errors/                                     │
  │    InsufficientBalance, MintUnreachable      │
  │  events/                                     │
  │    EventBus ──────────────────────────────┐  │
  │                                           │  │
  └───────────────────────────────────────────┼──┘
                                              │
                                     ┌────────▼────────┐
                                     │  store/ (Zustand)│
                                     │  반응형 캐시      │
                                     │  EventBus→UI    │
                                     │  비즈니스로직 없음 │
                                     └────────┬────────┘
                                              │ subscribes
                                         ┌────▼────┐
                                         │ React UI│
                                         └─────────┘
```

### 헥사곤 내부 — 3개 층

안쪽도 안과 바깥이 있다. 의존은 항상 안쪽을 향한다.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                                                    │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │                                              │  │  │
│  │  │           domain/  (최안쪽)                    │  │  │
│  │  │                                              │  │  │
│  │  │  Amount { value: bigint, unit: 'sat'|'usd' } │  │  │
│  │  │  Transaction { id, method, amount, status }  │  │  │
│  │  │  DomainEvent 타입                             │  │  │
│  │  │  순수 함수: add(), subtract(), isZero()       │  │  │
│  │  │                                              │  │  │
│  │  │  ※ 아무것도 import하지 않음                     │  │  │
│  │  │                                              │  │  │
│  │  └────────────────────┬─────────────────────────┘  │  │
│  │                       │ 참조                        │  │
│  │          ports/  (경계)                              │  │
│  │                                                    │  │
│  │  Driving Ports              Driven Ports           │  │
│  │  ┌───────────────────┐     ┌────────────────────┐  │  │
│  │  │ PaymentUseCase    │     │ WalletModule       │  │  │
│  │  │  send(Amount)     │     │  getBalance()→Amt  │  │  │
│  │  │  receive(Amount)  │     │  getAdapters()     │  │  │
│  │  │                   │     │                    │  │  │
│  │  │ BalanceUseCase    │     │ PaymentMethod      │  │  │
│  │  │  getTotal()→Amt   │     │  Adapter           │  │  │
│  │  │                   │     │  prepareSend(Amt)  │  │  │
│  │  │ NfcCardUseCase    │     │  executeSend(id)   │  │  │
│  │  │ SwapUseCase       │     │                    │  │  │
│  │  │                   │     │ SwapProvider       │  │  │
│  │  │                   │     │                    │  │  │
│  │  │                   │     │ TransactionRepo    │  │  │
│  │  │                   │     │ SettingsRepo       │  │  │
│  │  │                   │     │ ContactRepo        │  │  │
│  │  └───────────────────┘     └────────────────────┘  │  │
│  │           ▲                         ▲              │  │
│  │           │ implements              │ uses         │  │
│  │           │                         │              │  │
│  │          services/  (헥사곤 내 가장 바깥)             │  │
│  │                                                    │  │
│  │  PaymentService implements PaymentUseCase          │  │
│  │    constructor(modules: WalletModule[])            │  │
│  │    send() → adapter.prepareSend(Amount)            │  │
│  │                                                    │  │
│  │  BalanceAggregator implements BalanceUseCase       │  │
│  │    getTotal() → modules.map(m → m.getBalance())   │  │
│  │                                                    │  │
│  │  EventBus (services 간 내부 통신)                    │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 층별 의존 규칙

```
services/ → ports/ → domain/
(바깥)      (경계)    (안쪽)
```

| 층 | 알고 있는 것 | 모르는 것 |
|---|---|---|
| **domain/** | 자기 자신만 | ports, services, 헥사곤 바깥 전부 |
| **ports/** | domain 타입 (`Amount` 등) | services 구현체, 헥사곤 바깥 전부 |
| **services/** | domain + ports | 헥사곤 바깥 (modules, ui) |

- `Amount`는 `PaymentUseCase`를 모른다
- `PaymentUseCase`는 `PaymentService`를 모른다
- `PaymentService`는 `CashuModule`을 모른다

**각 층은 자기보다 안쪽만 안다.**

---

## 3. 핵심 용어

### Domain

비즈니스 규칙. 외부 라이브러리를 import하지 않는 순수 코드.

- `Amount` — 값 + 단위 (`{ value: 1000n, unit: 'sat' }`)
- `Transaction` — 거래 기록 (method, protocol을 string으로 열어두어 확장 가능)

### Port

안쪽이 정의하는 인터페이스. TypeScript `interface`.

**Driving Port (UseCase):** UI가 앱을 호출하는 계약.
- `PaymentUseCase` — 지갑 목록 조회, 송수신, 수수료 추정
- `BalanceUseCase` — 통합/Module별 잔액
- `NfcCardUseCase` — NFC 카드 읽기/쓰기
- `SwapUseCase` — cross-layer swap

**Driven Port:** 앱이 외부에 요청하는 계약.
- `WalletModule` — SDK 캡슐화 단위. 잔액, adapter 제공, lifecycle
- `PaymentMethodAdapter` — 송수신 방법. Module이 구현
- `SwapProvider` — swap 경로 제공 (Boltz 등)
- `TransactionRepository` — 거래내역 저장/조회
- `SettingsRepository` — 앱 설정 저장/조회
- `ContactRepository` — 연락처 저장/조회

### Adapter

Port를 실제로 구현하는 클래스. 외부 기술에 의존.

**Driving Adapter:** React hooks. UseCase Port를 호출.
**Driven Adapter:** Driven Port를 구현.
- SDK: `CashuModule`, `FedimintModule` 등 → `WalletModule` 구현
- Swap: `BoltzSwapProvider` 등 → `SwapProvider` 구현
- Storage: `DexieTransactionRepository` 등 → `Repository` 구현

### Module

SDK를 감싸는 최상위 Driven Adapter. 하나의 Module이 여러 Adapter를 제공.

```
CashuModule
  ├── cashu:lightning (PaymentMethodAdapter)
  ├── cashu:ecash    (PaymentMethodAdapter)
  └── nfc-card       (ModuleCapability)
```

Module 내부 구조(mintQuote, meltQuote, Coco SDK 호출)는 바깥에 노출되지 않는다. `internal/` 디렉터리에 격리.

### Persistence (저장소)

DB도 Driven Adapter다. 앱은 Repository Port를 정의하고, 구체 저장소(Dexie, SQLite)가 구현한다.

**두 종류의 DB:**
- **Module 내부 DB** — Coco가 자체 관리하는 proof, quote 등. `modules/cashu/internal/`에 격리. 앱이 직접 접근하지 않는다.
- **앱 레벨 DB** — 거래내역, 설정, 연락처. Repository Port를 통해 접근. Dexie든 SQLite든 교체 가능.

```
앱 레벨: services/ → TransactionRepository Port ← DexieAdapter (교체 가능)
Module:  CashuModule → internal/ → Coco IndexedDB (Module이 자체 관리)
```

### Error 경계

에러는 **경계를 넘을 때마다 변환**. 안쪽은 바깥의 에러 타입을 모른다.

```
SDK 에러              → Module internal에서 Domain 에러로 변환
Domain 에러           → Service에서 Result<T, Error>로 반환 (throw 안 함)
Result.error          → Hook에서 UI 표시 (toast, 에러 화면)
```

**3개 경계:**

| 경계 | 변환 | 예시 |
|------|------|------|
| SDK → Module internal | SDK 에러 → Domain 에러 | `"Not enough funds"` → `InsufficientBalanceError` |
| Service → UseCase 반환 | try/catch → `Result<T, E>` | catch → `{ ok: false, error: { code: 'INSUFFICIENT_BALANCE' } }` |
| Hook → UI | error code → i18n 메시지 | `error.INSUFFICIENT_BALANCE` → "잔액이 부족합니다" |

Domain 에러는 `core/errors/`에 정의. SDK 이름이 없는 순수 에러.

### EventBus vs Store (Zustand)

둘 다 필요하고, 역할이 다르다.

**EventBus:** 안쪽에서 안쪽으로. 이벤트(사실)를 전파. Service 간 결합 없는 통신.
**Store:** 안쪽에서 바깥(UI)으로. 최신 상태를 유지. React가 구독해서 리렌더.

```
PaymentService
  → eventBus.emit('payment:completed')          # 사실 전파 (안쪽 → 안쪽)
      → BalanceAggregator가 듣고 잔액 재계산       # Service 간 통신
      → bootstrap가 듣고 store.setBalance()       # 안쪽 → 바깥 연결
          → Zustand store 갱신                    # 상태 유지
              → React 리렌더                      # UI 반영
```

| | EventBus | Zustand Store |
|---|---|---|
| **위치** | 헥사곤 안쪽 (`core/events/`) | 헥사곤 바깥 (`store/`) |
| **역할** | 이벤트(사실) 전파 | 상태 유지 + UI 구독 |
| **소비자** | services, bootstrap | React 컴포넌트 |
| **방향** | 안쪽 → 안쪽 | 안쪽 → 바깥 |
| **데이터** | 일회성 이벤트 | 최신 스냅샷 |

EventBus 없이 Store만 → Service가 store를 직접 import → 헥사곤 위반.
Store 없이 EventBus만 → React가 이벤트 직접 구독 → 상태 관리 분산.

**bootstrap이 이 둘을 연결하는 유일한 지점이다.**

### Service

UseCase Port를 구현하는 application 레이어 코드. Driven Port를 통해 외부에 접근.

- `PaymentService` — 지갑 선택 → method 선택 → adapter 호출
- `BalanceAggregator` — 전 Module의 `getBalance()` 합산

### Bootstrap / AppManager

유일하게 모든 것을 알고 연결하는 조립 지점.

- Module 생성, seed + derivation path로 초기화
- Service에 Module + Repository 주입
- EventBus → Store 연결 (이벤트 → 상태 갱신)
- Watcher 시작 (lifecycle, network 등)
- UseCase Port 구현체를 UI Context에 제공

---

## 4. 의존성 규칙

### 방향

```
UI → hooks → UseCasePort → services → DrivenPort ← modules
```

화살표는 항상 안쪽을 향한다. 안쪽은 바깥을 import하지 않는다.

### 디렉터리별 규칙

| 디렉터리 | import 가능 | import 금지 |
|---------|------------|------------|
| `core/domain/` | 없음 (순수) | 전부 |
| `core/ports/` | `core/domain/`, `core/errors/` | 나머지 전부 |
| `core/events/` | `core/domain/` | 나머지 전부 |
| `core/errors/` | `core/domain/` | 나머지 전부 |
| `services/` | `core/` | `modules/`, `ui/`, `hooks/`, `store/` |
| `modules/` | `core/` | `services/`, `ui/`, `hooks/`, `store/`, 다른 `modules/` |
| `modules/*/internal/` | 해당 module 내부 + `core/` | 바깥 전부 (다른 module 포함) |
| `adapters/storage/` | `core/` | `services/`, `modules/`, `ui/` |
| `hooks/` | `core/ports/driving/`, `store/` | `services/`, `modules/` |
| `watchers/` | `core/ports/driving/` | `services/`, `modules/`, `store/` |
| `store/` | `core/domain/` 타입만 | `services/`, `modules/`, `hooks/` |
| `ui/` | `hooks/`, `store/` | `services/`, `modules/`, `core/` |
| `vault/` | 자체 코드, `cashu-ts` 유틸 | `modules/`, `services/` (완전 독립) |
| `app/`, `bootstrap.ts` | **전부** (조립 지점) | — |

### 위반 판별

```
// ✅ 정상: service가 Port 사용
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'

// ✅ 정상: module이 Port 구현
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'

// ❌ 위반: service가 module 구현체 직접 참조
import { CashuModule } from '@/modules/cashu/cashu.module'

// ❌ 위반: hook이 service 직접 참조
import { PaymentService } from '@/services/payment/payment.service'

// ✅ 정상: hook이 UseCase Port 참조
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'

// ✅ 정상: service가 Repository Port 사용
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

// ❌ 위반: service가 Dexie 구현체 직접 참조
import { DexieTransactionRepository } from '@/adapters/storage/dexie/transaction.repository'
```

---

## 5. 도메인 추가 가이드

### 5-1. 새 WalletModule 추가 (e.g., Fedimint)

**영향 범위:** `modules/fedimint/` 신규 + `bootstrap.ts` 등록. 기존 코드 수정 0.

체크리스트:

1. `modules/fedimint/fedimint.module.ts` — `WalletModule` 인터페이스 구현
2. `modules/fedimint/internal/` — Fedimint SDK 래퍼. 바깥에서 import 금지
3. `modules/fedimint/adapters/` — `PaymentMethodAdapter` 구현 (fedi:lightning, fedi:ecash)
4. `bootstrap.ts` — Module 생성 + 초기화 + 서비스에 등록
5. derivation path 정의 (e.g., `m/129372'/1'`)

**기존 파일 수정:** `bootstrap.ts`(또는 `AppManager`)에 등록 1줄 추가. 그 외 0.

### 5-2. 새 PaymentMethodAdapter 추가 (e.g., bolt12)

**영향 범위:** 해당 Module의 `adapters/` 내부. 기존 코드 수정 0.

체크리스트:

1. 기존 Module adapter 내부에 protocol codec 추가 (e.g., `bolt12.codec.ts`)
2. adapter에서 protocol 선택 로직 추가 (mint 능력 확인 → bolt12 사용)
3. `PaymentMethodAdapter` 인터페이스는 변경 없음 — `prepareSend`, `executeSend` 동일

**기존 파일 수정:** 0. adapter 내부 변경만.

### 5-3. 새 화폐 서비스 추가 (e.g., 정기 결제)

**영향 범위:** `core/ports/driving/` + `services/` 신규. Module, UI 기존 코드 수정 0.

체크리스트:

1. `core/ports/driving/recurring-payment.usecase.ts` — Driving Port 정의
2. `services/recurring-payment/` — UseCase 구현. Driven Port(`WalletModule`)를 통해 adapter 호출
3. `hooks/use-recurring-payment.ts` — UseCase Port를 React에 연결
4. `bootstrap.ts` — 서비스 생성 + 주입

**기존 파일 수정:** `bootstrap.ts`에 등록 추가. 그 외 0.

### 5-4. 새 비화폐 서비스 추가 (e.g., 티켓)

**영향 범위:** `vault/ticket/` 신규. 화폐 아키텍처 수정 0.

체크리스트:

1. `vault/ticket/ticket.service.ts` — `TokenVault` + `cashu-ts` 유틸 사용
2. `hooks/use-ticket.ts`
3. UI 화면 추가

**기존 파일 수정:** 0. `TokenVault`가 이미 존재하면 service 파일만 추가.

### 5-5. 새 Repository 추가 (e.g., 거래 메모 저장)

**영향 범위:** `core/ports/driven/` + `adapters/storage/` 신규. services는 Port만 사용.

체크리스트:

1. `core/ports/driven/memo.repository.port.ts` — Repository Port 정의 (interface)
2. `adapters/storage/dexie/dexie-memo.repository.ts` — Dexie로 구현
3. 필요한 service에 Port 타입으로 주입
4. `bootstrap.ts` — 구현체 생성 + service에 주입

**기존 파일 수정:** `bootstrap.ts`에 조립 추가. 그 외 0.

**persistence 교체 시:** Dexie → SQLite로 바꾸려면 `adapters/storage/sqlite/` 구현체만 새로 작성. Port와 service 코드 수정 0.

### 5-6. 새 SwapProvider 추가 (e.g., Cashu native on-chain)

**영향 범위:** `modules/` 내 provider 또는 `services/swap/providers/` 신규.

체크리스트:

1. `SwapProvider` 인터페이스 구현
2. `supportedPairs` 정의 (e.g., `{ from: cashu:lightning, to: onchain:btc }`)
3. `bootstrap.ts` — SwapService에 provider 등록

**기존 파일 수정:** `bootstrap.ts`에 등록 추가. 그 외 0.

### 추가 시 공통 원칙

```
1. 새 파일 먼저, 기존 파일 수정은 bootstrap 등록뿐
2. Port 인터페이스를 먼저 정의, 구현은 나중에
3. internal/은 반드시 해당 module 안에서만 import
4. 의존 방향 위반 없는지 확인 (안쪽 → 바깥 import 금지)
```

---

> 각 Part의 구체적 코드 예시, 흐름 추적, 마이그레이션 순서는 별도 문서에서 다룬다.
> - `hexagonal-code-examples.md` — Port, Adapter, Service 코드 예시
> - `multi-sdk-architecture-draft_v3.md` — Multi-SDK 설계 초안 (Port 인터페이스 전체, 결정 사항, 디렉터리 구조)
