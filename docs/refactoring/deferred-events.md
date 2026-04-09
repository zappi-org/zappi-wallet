# Deferred Domain Events

Phase 1에서 제외한 이벤트. multi-module 또는 해당 기능 구현 시 추가.

## module:initialized / module:disposed

**언제:** multi-module (Fedimint, Onchain 등) 추가 시.
단일 Cashu 모듈만 있을 때는 bootstrap에서 직접 처리하면 됨.

**왜 필요해지는가:**
- Module마다 초기화 시점이 다름 (네트워크, SDK 로딩 속도 차이)
- UI가 "어떤 모듈이 준비됐는지" 개별 추적 필요
- dispose 순서 관리 (의존 관계 있는 모듈 정리)

**추가 시 체크리스트:**
1. `domain-events.ts`에 `ModuleInitializedEvent`, `ModuleDisposedEvent` 추가
2. `WalletModule.initialize()` 완료 후 `eventBus.emit('module:initialized')`
3. bootstrap에서 이벤트 → store 연결 (`store.setModuleReady(moduleId, true)`)
4. UI 로딩 상태를 모듈별로 분리

## swap / nfc 관련 이벤트

Swap, NFC 기능 구현 시 해당 도메인 이벤트 정의. 지금은 기능 자체가 없으므로 생략.
