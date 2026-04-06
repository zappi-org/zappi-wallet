/**
 * 외부 오퍼레이션 참조값 → 내부 트랜잭션 ID 매핑.
 *
 * SDK가 발급한 operationId를 우리 도메인의 txId로 변환한다.
 * read-only: 매핑의 write/delete는 pendingSendTokens 저장/삭제 흐름이 담당.
 */
export interface OperationMap {
  resolve(operationRef: string): Promise<string | null>
}
