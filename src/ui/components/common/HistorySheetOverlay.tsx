import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const dismissLock = useRef(false)
  const hasScrolledRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const reducedMotion = useReducedMotion()

  const HEADER_ZONE_HEIGHT = 200

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

    if (inHeaderZone || !hasScrolledRef.current) {
      dragControls.start(e)
    }
  }, [dragControls])

  const handleDragEnd = useCallback(
    (_: PointerEvent, info: { offset: { y: number }; velocity: { y: number } }) => {
      if (info.offset.y > 60 || info.velocity.y > 192) {
        doClose()
      }
      hasScrolledRef.current = true
    },
    [doClose],
  )

  useEffect(() => {
    if (!open) {
      hasScrolledRef.current = false
      return
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, doClose])

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
          if (scroller!.scrollTop > 2) {
            hasScrolledRef.current = true
          }
        }
        scroller.addEventListener('scroll', scrollHandler, { passive: true })
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

  const handleFocusEntry = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement
    sheetRef.current?.focus()
  }, [])

  const handleFocusReturn = useCallback(() => {
    previousFocusRef.current?.focus()
    previousFocusRef.current = null
  }, [])

  const springTransition = reducedMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, damping: 25, stiffness: 200 }

  const opacityTransition = reducedMotion
    ? { duration: 0.01 }
    : { duration: 0.2 }

  return (
    <AnimatePresence onExitComplete={handleFocusReturn}>
      {open && (
        <>
          <motion.div
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={opacityTransition}
            className="absolute inset-0 bg-black z-40"
            style={{ isolation: 'isolate' }}
            onClick={doClose}
          />

          <motion.div
            key="history-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('history.title')}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springTransition}
            onAnimationComplete={handleFocusEntry}
            drag="y"
            dragSnapToOrigin
            dragConstraints={{ top: 0, bottom: 500 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragControls={dragControls}
            dragListener={false}
            onDragEnd={handleDragEnd}
            onPointerDown={handlePointerDown}
            className="absolute inset-x-0 bottom-0 top-[6vh] z-50 rounded-t-2xl overflow-hidden bg-background flex flex-col outline-none"
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
                  isSheet
                />
              </Suspense>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
