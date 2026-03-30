/**
 * Coco SDK — Manager 인스턴스 접근 레이어
 *
 * 기존 coco/manager.ts의 싱글톤을 그대로 사용한다.
 * CashuBackend는 이 모듈을 통해서만 Manager에 접근한다.
 * Phase 7에서 coco/manager.ts를 이 모듈로 완전 이전.
 */

export {
  getCocoManager,
  resetCocoManager,
  isCocoInitialized,
  deleteCocoData,
  enableWatchers,
  recheckPendingMintQuotes,
  getPendingMintQuotes,
  getMintQuote,
} from '@/coco/manager';
