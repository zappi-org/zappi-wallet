import { createContext } from 'react'

type BackHandler = () => boolean

export interface BackHandlerContextValue {
  /** Register a back handler. Returns cleanup function. */
  pushBackHandler: (handler: BackHandler) => () => void
  /** Invoke the topmost back handler. Falls through stack until one returns true. */
  goBack: () => void
  /** Returns the number of registered back handlers (0 = none, 1 = base only, 2+ = flow handlers exist) */
  handlerCount: () => number
}

export const BackHandlerContext = createContext<BackHandlerContextValue | null>(null)
