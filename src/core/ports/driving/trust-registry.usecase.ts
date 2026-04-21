/**
 * TrustRegistry — 결제 계정의 신뢰 상태 관리 (프로토콜 중립)
 *
 * `accountId` 는 프로토콜별 식별자 — cashu 에서는 mint URL, 향후 다른
 * 프로토콜(Lightning LSP 등)에서는 해당 식별자. 포트 수준에서는 opaque string.
 *
 * 현재 구현은 cashu mint 에 한정되어 있지만, 포트 계약은 protocol-agnostic.
 */

export interface TrustRegistry {
  /** 지정된 account 가 신뢰 목록에 있는지 확인. */
  isTrusted(accountId: string): Promise<boolean>

  /** 신뢰 목록에 추가. 이미 있으면 no-op (idempotent). */
  addTrust(accountId: string): Promise<void>

  /** 신뢰 목록에서 제거. 없으면 no-op. */
  revokeTrust(accountId: string): Promise<void>

  /** 현재 신뢰중인 account 전체. */
  getTrustedAccounts(): Promise<string[]>
}
