import { useCallback, useRef, type ReactNode } from 'react'
import { BackHandlerContext } from './back-handler-context'

export { type BackHandlerContextValue } from './back-handler-context'

export function BackHandlerProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<(() => boolean)[]>([])

  const pushBackHandler = useCallback((handler: () => boolean) => {
    stackRef.current.push(handler)
    return () => {
      const idx = stackRef.current.indexOf(handler)
      if (idx !== -1) stackRef.current.splice(idx, 1)
    }
  }, [])

  const goBack = useCallback(() => {
    for (let i = stackRef.current.length - 1; i >= 0; i--) {
      if (stackRef.current[i]()) return
    }
  }, [])

  const handlerCount = useCallback(() => stackRef.current.length, [])

  return (
    <BackHandlerContext.Provider value={{ pushBackHandler, goBack, handlerCount }}>
      {children}
    </BackHandlerContext.Provider>
  )
}
