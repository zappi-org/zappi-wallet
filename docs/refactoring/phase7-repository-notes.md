# Phase 7: Repository Adapter 전환 주의사항

Phase 2 adapter는 기존 repo에 위임(delegation)하는 구조다. Phase 7에서 기존 repo 삭제 시:

1. adapter 내부를 Dexie 직접 접근으로 교체 (`getDatabase().transactions` 등)
2. 기존 `TransactionRepository`의 fiat enrichment 로직을 adapter로 이전 (또는 service 레이어로 이동 결정)
3. 기존 singleton (`getTransactionRepo()`, `getContactRepo()`) 제거 후, bootstrap에서 adapter를 직접 생성/주입
4. `SettingsRepository`의 default 값 병합 로직 (`getDefaultSettings()`)을 adapter로 이전
5. 기존 `data/repositories/` 디렉터리 전체 삭제 전, `grep -r "data/repositories" src/` 로 잔여 import 0 확인
