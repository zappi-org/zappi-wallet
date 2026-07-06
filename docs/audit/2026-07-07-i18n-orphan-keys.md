# i18n 참조-0 로케일 키 삭제 감사 (R2-A)

일자: 2026-07-07 · 대상: `src/i18n/locales/{en,ko,ja,es,id}.ts` (5개 로케일 동시 삭제, 구조 동일 유지)
검증 게이트: `check:phantom` / `eslint` / `tsc -b + vite build` / `vitest run`(137파일·1136테스트, locale-parity 포함) / `test:coverage`(임계 통과) — 삭제 후 전부 green.

**결과 요약**: 총 1,312키 중 **449키 삭제** (1,312 → 863), **보류 3키**, 보호 네임스페이스로 잔존한 참조-0 키 다수(§4 — 의도된 잔존).

---

## 1. 방법론 — 판정 파이프라인

키별 판정은 아래 순서의 파이프라인으로 수행했다. 스캔 표면: `src/**/*.{ts,tsx,js,jsx,mjs,cjs,html}`(로케일 데이터 5파일 제외, `__tests__` 포함) + `scripts/**` + `index.html` + `vite.config.ts`.

1. **보호 프리픽스** (§2에서 도출) 에 해당 → 참조 0 이어도 **삭제 금지**.
2. **동적 조립 프리픽스 자동 재도출** — 스캔 표면 전체의 템플릿 리터럴(`\`…${`)에서 점(.) 포함 정적 프리픽스를 전수 추출해 로케일 키와 대조. §2 수동 목록과 완전 일치 확인(누락 0).
3. **정적 참조** — 키 전체 문자열이 따옴표(`'`/`"`/backtick)로 감싸인 리터럴로 존재 → 참조로 카운트. `t('…')`, `i18n.t('…')`(composition 층 포함), `<Trans i18nKey>`, config 객체(`labelKey`/`titleKey`/`STATUS_KEY` 맵 등), 테스트 단언, `error-i18n.ts` 고정 방출 키(EMITTED_KEYS)까지 호출 형태와 무관하게 전부 포착된다.
4. **복수형 접미사** — `_zero/_one/_two/_few/_many/_other`(+ `_ordinal_*`) 키는 base 키 참조로 카운트. (본 코드베이스는 count 키를 단일형 `{{count}}` 로 쓰고 있어 실제 해당 키 0건 — 유일한 `_other` 매치인 `support.categories.idea_other` 는 복수형이 아니라 카테고리 enum 리터럴이며 보호 프리픽스로 잔존.)
5. **경계 있는 비인용 출현 / 점 포함 부모 경로의 인용 출현** → 애매 → **보류(HOLD)**. 삭제하지 않음.
6. 위 전부 아님 → **삭제**.

추가로 폐쇄 확인한 우회 경로: `useTranslation` `keyPrefix` **0건**, `returnObjects` **0건**, 문자열 연결(`'…' +`) 키 조립 **0건**, 완전 변수 템플릿(`t(\`${…}\`)`) **0건**, `i18nKey={변수}` **0건**(리터럴 삼항만 존재), `t(변수)` 호출 전수 추적 — 전부 리터럴 상수/보호 템플릿으로 환원됨(예: `SupportPage.tsx:913-916,1042,1152` 의 `emptyKey`/`footerKey` 등, `TokenDetailScreen.tsx:50` `DATE_SUFFIX_KEY`, `TimelineRow.tsx:35` `STATUS_KEY`).

## 2. 보호 프리픽스 — 동적 조립 사이트 전수 도출 결과

| 프리픽스 | 근거 (file:line) | 비고 |
|---|---|---|
| `errors.*` | `error-i18n.ts:38,57` / `error-message.ts:21,23` — ERROR_CODE→camelCase convention 조립, `i18n.exists()` 가드 | 정적 참조 0 이 정상 (33/47키가 참조 0) |
| `txDetail.source.*` | `tx-source.ts:20`, `TransactionRow.tsx:71`, `HistoryTimelineRow.tsx:75` | `meta.source` 키 조립 |
| `token.detail.weekday.*` | `token-view-model.ts:31` | 요일 조립 (sun~sat) |
| `token.detail.title.*` | `TokenDetailScreen.tsx:141` | `data.status` 조립 |
| `token.detail.typeValue.*` | `TokenDetailScreen.tsx:140` | 〃 |
| `token.detail.mintLabel.*` | `TokenDetailScreen.tsx:139` | 〃 |
| `support.csStatus.*` | `CSStatusChip.tsx:38` | `kind` 조립 |
| `support.categories.*` | `SupportPage.tsx:990,1288` | `ticket.category` 조립 — 저장된 과거 티켓의 legacy 카테고리(general/technical/billing)도 도달 가능하므로 참조-0 키 포함 전체 보존 |
| `support.threadStatusEvent.*` | `SupportPage.tsx:1186` | `event.to` 조립 |
| `support.faq.*` (q1~q6/a1~a6) | `SupportPage.tsx:735,867,879` | `q${i+1}`/`a${n}` 조립 (FAQ_COUNT=6) |
| **`contacts.verify.*`** | `ContactFormModal.tsx:123` — `contacts.verify.${result.errorCode}` | **과업 제시 목록에 없던 신규 도출 프리픽스** (7키) |
| `token.time.*` | (동적 조립 사이트 없음 — 전 키 정적 참조 존재) | 과업 지정 보호 유지 |
| `notifications.*` | (동적 조립 사이트 없음 — 17키 중 15키 정적 참조) | 과업 지정 보호 유지 |

**과업 제시 목록과의 차이**: ① `contacts.verify.*` 추가 (실제 동적 조립 사이트 존재 — 미보호 시 연락처 검증 에러 문구 7종이 오삭제될 뻔함). ② `token.time.*` / `notifications.*` 는 동적 조립·복수형 근거가 실재하지 않음(count 키가 전부 단일형) — 다만 과업 지시대로 보호 유지, 이로 인해 잔존한 참조-0 키는 §4에 기록. ③ 나머지 11개 패밀리는 제시 목록과 일치하며, 자동 재도출(§1-2)이 수동 목록 대비 누락 0 임을 상호 검증.

## 3. 삭제 키 전량 — 449키 (키별 판정)

판정 기준(전 행 공통): **정적 0 · 보호 프리픽스 비해당 · 복수형 비해당** — 추가로 비인용 출현·부모 경로 인용 출현도 0 임을 확인한 키만 삭제했다.
아래 10개 서브트리는 전 leaf 삭제로 부모 노드째 제거: `support.connectionStatus`(5) `support.categoryDescriptions`(5) `support.priorities`(2) `support.priorityDescriptions`(2) `support.status`(4) `receive.tokenInputStep`(4) `receive.transport`(5) `receive.offline`(7) `receive.sourceRecovery`(5) `token.history.group`(4). (구 지원 UI의 status/priority 계열은 보호 대상인 `support.csStatus.*` 로 대체된 사어 패밀리.)


### `payment.*` — 129키

| 키 | 판정 |
|---|---|
| `payment.receiveWithThisMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.currentBalance` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.requiredAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintOffline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.noAvailableMints` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.noCompatibleMints` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintNoBalance` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.networkError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.amount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.processing` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.confirm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.done` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.cancel` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.share` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.scan` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paste` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.qrScan` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sendComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.receiveComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.lightningPay` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.lightningSend` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.recipient` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.destination` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.pay` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paying` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paymentFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paymentSuccess` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.addressOrInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.addressPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.lightningAddressPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.enterDestination` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.minAmountError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.maxAmountError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invalidAddressOrInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invalidLightningAddress` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.cannotVerifyAddress` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.lightningSendFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sendError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.clipboardError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.lightningReceive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.createInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.creating` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invoiceCreated` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.waitingPayment` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.shareInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.copyInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.expiresIn` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paymentReceived` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.ecashSend` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.memoPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.ecashToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.createToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.creatingToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenCreated` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.shareToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.copyToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenCreateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenCreateError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenSpent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenSpentDesc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenLostWarning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenReceiveFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenReceiveError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.trustAndReceive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.swapRequired` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.compatibleMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.requestedMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.ecashReceive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.createRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.requestCreated` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.shareRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.copyRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.paymentRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.waitingNostrDm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenReceive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenInfo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.receiveToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenOnly` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenReclaimFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.receiving` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sending` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenReceived` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenAlreadySpent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.enterAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.amountInSats` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.zapSend` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.zapTo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sendZap` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.zapping` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.zapSent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sendingNostrDm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.sentViaNostrDm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.willSendViaNostrDm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.checkingReceipt` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintAdded` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintAddFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.successReceived` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.trustStatus` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.trusted` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.untrusted` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.untrustedMintWarning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.receiveAmountBtn` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintSelectedOffline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.createInvoiceError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.recreateInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.withdrawSource` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.minValidation` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.maxValidation` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.creatingInvoice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.remainingTime` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invoiceExpired` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invoiceCreateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.invoiceCreateError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintOfflineWarning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.tokenProcessError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.mintTrustAddFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.untrustedMintLabel` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.addMintTrustQuestion` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.addingTrust` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.trustMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.reEnter` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.scanOrPasteToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.nfc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.wave` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.nfcComingSoon` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.waveComingSoon` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `payment.comingSoon` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `receive.*` — 64키

| 키 | 판정 |
|---|---|
| `receive.senderMethod` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.lightning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.ecash` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.toMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.toMintPrefix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.toMintSuffix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.howMuch` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.memoPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.receiveToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.createRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.scanQr` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInput` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInputPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInputStep.accountTo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInputStep.haveToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInputStep.placeholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.tokenInputStep.hint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.amountStep.memoPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.qr.showToSender` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.qr.willNotify` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.qr.depositNotify` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.qr.cancel` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.transport.nostrAndHttp` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.transport.httpOnly` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.transport.nostrOnly` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.transport.unified` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.transport.lightningOnly` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.complete.message` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.complete.received` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.canReceive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.fullConfirmQuestion` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.amount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.confirmQuestion` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.crossMintQuestion` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.tokenFrom` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.tokenFromSuffix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.receiveDirectly` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.receiveDirectlySub` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.receiveViaSwap` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.receiveViaSwapSub` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.rejectSub` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.fee` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.noFee` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.token.feeApplies` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.untrusted.warningFrom` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.untrusted.explanation` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.p2pkAccepted` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.dleqMissing` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.dleqFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.nonP2PKError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.untrustedNeedsOnline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.receiveOffline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.offline.acceptAnyway` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapFeeTooHigh` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapTokenTooSmall` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapEstimateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapReceiveKeptOnSource` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapCompletedWithSourceRemainder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.swapCompletedWithHiddenSourceRemainder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.sourceRecovery.title` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.sourceRecovery.description` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.sourceRecovery.mint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.sourceRecovery.addMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `receive.sourceRecovery.later` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `support.*` — 45키

| 키 | 판정 |
|---|---|
| `support.heroDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectionStatus.disabled` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectionStatus.idle` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectionStatus.connecting` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectionStatus.connected` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectionStatus.error` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connecting` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.connectingDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.newTicket` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.startNewTicket` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.titlePlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.bodyPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.privacyNote` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.priorityLabel` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.categoryDescriptions.transfer` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.categoryDescriptions.ecash` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.categoryDescriptions.fee` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.categoryDescriptions.security` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.categoryDescriptions.other` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.priorities.normal` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.priorities.high` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.priorityDescriptions.normal` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.priorityDescriptions.high` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.sending` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.sendingToRelay` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.sendingMessage` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.updateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.downloadFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.myTickets` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.ticketCount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.unreadCount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.attachmentPreview` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.downloadingAttachment` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.filePreview` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.ticketActions` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.pinTicket` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.unpinTicket` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.markRead` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.resolvedNotice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.closedNotice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.status.open` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.status.in_progress` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.status.resolved` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.status.closed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `support.helpFooter` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `settings.*` — 33키

| 키 | 판정 |
|---|---|
| `settings.zappiUser` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.lightningAddressRequired` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.addressChangeFee` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.recommended` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.biometric` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.verifyBalance` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.findUnusedTokens` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsTest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsTestDesc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsBolt11Send` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsBolt11Receive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsEcashCreate` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsEcashRedeem` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsGiftWrap` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.tlsCreq` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.updateInstallHint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.noMints` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.mintCount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.noRelays` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.change` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.restoreChoiceDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.currentWalletRecoveryDesc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.externalMnemonicRecoveryDesc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.passkeySetup` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.passkeyRemove` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.position` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.moveUp` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.moveDown` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.selectCurrency` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.posDeviceCount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.posQrReady` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.active` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `settings.faceIdDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `send.*` — 28키

| 키 | 판정 |
|---|---|
| `send.fromMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.fromMintPrefix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.fromMintSuffix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.whereTo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.placeholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.howMuch` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.createToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.myWallet` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.sameWalletError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.destinationRequired` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.destination.accountFrom` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.destination.hint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.amount.sendTo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.amount.balancePill` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.amount.memoPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.tokenCreate.title` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.tokenCreate.memo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.question` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.transferQuestionEnd` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.feeEstimateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.toSuffix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.amountSuffix` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.confirm.questionEnd` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.sending.message` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.sending.inProgress` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.complete.message` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.complete.sent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `send.complete.details` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `toast.*` — 27키

| 키 | 판정 |
|---|---|
| `toast.saved` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.deleted` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.paymentSuccess` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.paymentFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.tokenReceived` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.ecashRecovered` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.lightningArrived` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.offlineTokensRedeemed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.lightningPaymentComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.lightningSendFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.lightningSendComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.invoiceCreateFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.invoiceCreateOffline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.tokenReceivedAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.tokenReclaimedAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.paymentRequestFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.sendComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.swapComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.offlineCannotPay` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.syncComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.syncErrors` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.syncFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.noRelays` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.retrySuccess` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.retryPartialFail` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.retryFailed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `toast.incomingTransferProcessed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `txDetail.*` — 22키

| 키 | 판정 |
|---|---|
| `txDetail.title` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.time` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.completedAt` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.failedAt` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenState` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenState.unspent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenState.pending` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenState.spent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenState.unknown` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.checkState` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.checking` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.reclaim` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.alreadySpent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.tokenPending` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.cancelSend` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.receivedToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.copyToken` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.share` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.receivedFrom` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.receivedEcash` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.unclaimedNotice` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `txDetail.fiatValue` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `mintDetail.*` — 14키

| 키 | 판정 |
|---|---|
| `mintDetail.send` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.receive` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.swap` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.created` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.editName` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.namePlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.mintContact` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.details` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.showQr` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.dangerZone` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.deleteComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.tabAll` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.unclaimedTokens` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetail.pendingRequests` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `common.*` — 13키

| 키 | 판정 |
|---|---|
| `common.sats` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.sat` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.error` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.success` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.skip` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.no` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.offline` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.online` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.total` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.processing` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.settings` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.notifications` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `common.syncing` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `addMint.*` — 11키

| 키 | 판정 |
|---|---|
| `addMint.mintUrl` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.recommended` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.mintDescMinibits` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.mintDescCoinos` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.mintDescLnbits` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.discoverMints` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.discoverDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.auditDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.added` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.addComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `addMint.mintAddedSuccess` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `scanner.*` — 11키

| 키 | 판정 |
|---|---|
| `scanner.inputPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invoiceExpired` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invalidAddress` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invalidRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.offlineError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.lnurlError` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.flashOn` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.flashOff` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invalidCashuRequest` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invalidNostrProfile` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `scanner.invalidNostrEvent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `onboarding.*` — 10키

| 키 | 판정 |
|---|---|
| `onboarding.importWallet` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.walletRecovery` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.enterRecoveryPhrase` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.words12` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.words24` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.recoverWallet` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.setPin` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.confirmPin` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.recoveringWallet` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `onboarding.recoveringWalletDesc` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `mintDetails.*` — 6키

| 키 | 판정 |
|---|---|
| `mintDetails.mintBalance` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetails.mintInfo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetails.contact` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetails.loadingInfo` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetails.deleteConfirm` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `mintDetails.balanceWarning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `token.*` — 6키

| 키 | 판정 |
|---|---|
| `token.history.group.today` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `token.history.group.yesterday` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `token.history.group.thisMonth` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `token.history.group.older` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `token.history.metaLine` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `token.detail.confirmLink` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `history.*` — 5키

| 키 | 판정 |
|---|---|
| `history.sent` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `history.received` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `history.failed` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `history.andMore` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `history.pendingTab` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `pwa.*` — 5키

| 키 | 판정 |
|---|---|
| `pwa.installTitle` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `pwa.installDescription` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `pwa.install` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `pwa.later` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `pwa.iosInstructions` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `transfer.*` — 4키

| 키 | 판정 |
|---|---|
| `transfer.transferAmount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `transfer.swapComplete` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `transfer.selectDifferentMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `transfer.estimatedFee` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `tokenRegister.*` — 4키

| 키 | 판정 |
|---|---|
| `tokenRegister.swapping` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `tokenRegister.receiveToMyMint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `tokenRegister.unknownMintHint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `tokenRegister.swapFeeHint` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `home.*` — 2키

| 키 | 판정 |
|---|---|
| `home.totalBalance` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `home.myMints` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `actions.*` — 2키

| 키 | 판정 |
|---|---|
| `actions.transfer` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `actions.scan` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `amountAction.*` — 2키

| 키 | 판정 |
|---|---|
| `amountAction.lightning` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `amountAction.ecash` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `analytics.*` — 2키

| 키 | 판정 |
|---|---|
| `analytics.transactionCount` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `analytics.allTime` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `contacts.*` — 2키

| 키 | 판정 |
|---|---|
| `contacts.memoPlaceholder` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |
| `contacts.optional` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `lock.*` — 1키

| 키 | 판정 |
|---|---|
| `lock.welcomeBack` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

### `redirect.*` — 1키

| 키 | 판정 |
|---|---|
| `redirect.toSend` | 정적 0 · 보호 프리픽스 비해당 · 복수형 비해당 |

## 4. 보류(HOLD) — 3키 (삭제하지 않음)

| 키 | 보류 사유 |
|---|---|
| `support.createTicket` | 정적 참조 0 이나 `SupportPage.tsx:287` 의 API 메서드 호출 `support.createTicket({…})` 과 문자열이 동일 — i18n 참조 아님이 유력하지만 동명 충돌로 자동 판별 불가 → 보수적 보류 |
| `settings.fiatCurrency` | `TokenScreen.tsx`/`PreferencesCategoryPage.tsx`/`FiatSettingPage.tsx` 에 스토어 경로 `settings.fiatCurrency` 로 비인용 출현 — 상태 경로와 i18n 키의 동명 충돌 → 보류 |
| `payment.send` | `UsernameChangeScreen.tsx`/`bootstrap.test.ts` 에 서비스 호출 `payment.send(…)` 로 비인용 출현 — 동명 충돌 → 보류 |

### 보호 프리픽스로 잔존한 참조-0 키 (의도된 잔존 — 삭제 금지 대상)

동적 조립 패밀리는 정적 참조 0 이 정상이다: `support.faq.*` 12/12, `token.detail.weekday.*` 7/7, `token.detail.{title,typeValue,mintLabel}.*` 각 4/4, `txDetail.source.*` 6/6, `support.threadStatusEvent.*` 4/4, `support.csStatus.*` 3/3, `contacts.verify.*` 7/7, `errors.*` 33/47, `support.categories.*` 3/12(general/technical/billing — 저장 티켓 경유 도달 가능). 과업 지정 블랭킷 보호로 잔존: `notifications.markAllRead`, `notifications.tokenReceived` (동적 사이트 부재 — 차기 정리 후보).

## 5. 검증 결과 (삭제 후)

| 게이트 | 결과 |
|---|---|
| `bun run check:phantom` | ✅ phantom deps 없음 (536 files) |
| `bun run lint` | ✅ 0 문제 |
| `bun run build` (tsc -b + vite) | ✅ — typed-i18next(`i18next.d.ts` CustomTypeOptions)가 정적 리터럴 키 전량을 컴파일 타임 검증하므로, 빌드 green = 오삭제된 정적 키 0 의 기계적 증명 |
| `bun run test:run` | ✅ 137 files / 1136 tests (시작 기준선과 동일, locale-parity 5로케일 키 구조·보간 변수 동등성 포함) |
| `bun run test:coverage` | ✅ exit 0 — 임계(`src/core/domain/**`, `src/composition/**`) 통과 (로케일 파일은 임계 대상 아님) |

삭제 후 5개 로케일 flatten 재검증: 각 863키, en 기준 missing 0 / extra 0, 삭제 집합과 정확히 일치(449키). 로케일 5파일 외 어떤 파일도 수정하지 않았다.
