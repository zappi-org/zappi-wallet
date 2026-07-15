import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import type { Transaction } from '@/core/domain/transaction'

const HistoryScreen = lazy(() => import('@/ui/screens/History/HistoryScreen'))

export interface HistorySheetOverlayProps {
  open: boolean
  onClose: () => void
  transactions: Transaction[]
  initialMintUrls?: string[]
}

export function HistorySheetOverlay({
  open,
  onClose,
  transactions,
  initialMintUrls,
}: HistorySheetOverlayProps) {
  const [contentAtTop, setContentAtTop] = useState(true)
  const contentAtTopRef = useRef(true)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const dismissLock = useRef(false)

  const HEADER_ZONE_HEIGHT = 90

  const doClose = useCallback(() => {
    if (dismissLock.current) return
    dismissLock.current = true
    onClose()
    setTimeout(() => { dismissLock.current = false }, 300)
  }, [onClose])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (dismissLock.current || !sheetRef.current) return
    const sheetRect = sheetRef.current.getBoundingClientRect()
    const yFromTop = e.clientY - sheetRect.top
    const inHeaderZone = yFromTop >= 0 && yFromTop <= HEADER_ZONE_HEIGHT

    if (inHeaderZone || contentAtTop) {
      dragControls.start(e)
    }
  }, [contentAtTop, dragControls])

  const handleDragEnd = useCallback(
    (_: PointerEvent, info: { offset: { y: number }; velocity: { y: number } }) => {
      if (info.offset.y > 96 || info.velocity.y > 320) {
        doClose()
      }
    },
    [doClose],
  )

  useEffect(() => {
    if (!open || !sheetRef.current) return

    const sheet = sheetRef.current
    let scroller: HTMLElement | null = null
    let scrollHandler: (() => void) | null = null

    const attachScrollListener = () => {
      const el = sheet.querySelector<HTMLElement>('[data-scroll-container]')
      if (el && el !== scroller) {
        if (scroller && scrollHandler) {
          scroller.removeEventListener('scroll', scrollHandler)
        }
        scroller = el
        scrollHandler = () => {
          const atTop = scroller!.scrollTop <= 2
          if (atTop !== contentAtTopRef.current) {
            contentAtTopRef.current = atTop
            setContentAtTop(atTop)
          }
        }
        scroller.addEventListener('scroll', scrollHandler, { passive: true })
        scrollHandler()
      }
    }

    const observer = new MutationObserver(() => {
      attachScrollListener()
    })

    observer.observe(sheet, { childList: true, subtree: true })
    attachScrollListener()

    const timeout = setTimeout(() => {
      attachScrollListener()
    }, 200)

    return () => {
      observer.disconnect()
      if (timeout) clearTimeout(timeout)
      if (scroller && scrollHandler) {
        scroller.removeEventListener('scroll', scrollHandler)
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, doClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black z-40"
            onClick={doClose}
          />

          <motion.div
            key="history-sheet"
            ref={sheetRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            drag="y"
            dragSnapToOrigin
            dragConstraints={{ top: 0, bottom: 500 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragControls={dragControls}
            dragListener={false}
            onDragEnd={handleDragEnd}
            onPointerDown={handlePointerDown}
            className="absolute inset-x-0 bottom-0 top-[6vh] z-50 rounded-t-2xl overflow-hidden bg-background flex flex-col"
          >
            <div className="flex justify-center py-3 shrink-0 touch-none">
              <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
            </div>

            <div className="flex-1 min-h-0">
              <Suspense fallback={<LoadingFallback />}>
                <HistoryScreen
                  onBack={doClose}
                  transactions={transactions}
                  initialMintUrls={initialMintUrls}
                />
              </Suspense>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
