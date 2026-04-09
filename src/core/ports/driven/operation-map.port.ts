/**
 * 외부 오퍼레이션 참조값 → 내부 트랜잭션 ID 매핑.
 *
 * SDK가 발급한 operationId를 우리 도메인의 txId로 변환한다.
 *
 * resolve: pendingSendTokens + 인메모리 매핑 양쪽에서 조회.
 * register: receive()에서 quoteId → txId 매핑 등록 (mintQuoteObserver가 settle 시 사용).
 */
export interface OperationMap {
  resolve(operationRef: string): Promise<string | null>
  register(operationRef: string, txId: string): void
}
