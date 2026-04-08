/**
 * SwapQuoteMarker — 스왑용 mint quote를 마킹하여
 * 일반 receive observer가 중복 TX를 생성하지 않도록 한다.
 */
export interface SwapQuoteMarker {
  mark(quoteId: string): void
  unmark(quoteId: string): void
}
