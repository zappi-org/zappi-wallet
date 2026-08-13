import { useEffect, useState } from 'react'

export type PaymentReceiptStatus = 'printing' | 'finishing' | 'pending' | 'done'

export function shouldStartReceiptTorn(status: PaymentReceiptStatus, supportsPaperAnimation: boolean): boolean {
  return status === 'done' || status === 'pending' || (status === 'finishing' && !supportsPaperAnimation)
}

/** Crawl budget for already-settled receipts; the finishing retarget picks
 *  the paper up mid-flight (~46% out on the printing curve). */
export const RECEIPT_PRINT_CRAWL_MS = 950

/** 'printing' until the crawl elapses, then 'finishing'. Reduced motion skips
 *  straight to 'finishing'. */
export function useReceiptPrintCrawl(reduceMotion: boolean | null): 'printing' | 'finishing' {
  const [finishing, setFinishing] = useState(!!reduceMotion)
  useEffect(() => {
    if (finishing) return
    const id = setTimeout(() => setFinishing(true), RECEIPT_PRINT_CRAWL_MS)
    return () => clearTimeout(id)
  }, [finishing])
  // Derived, not set in the effect: reduced motion turning on mid-crawl skips
  // ahead immediately; the pending timer then lands on the same value.
  return finishing || reduceMotion ? 'finishing' : 'printing'
}
