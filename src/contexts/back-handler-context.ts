import { createContext } from 'react'

type BackHandler = () => boolean

export interface BackHandlerContextValue {
  /** Register a back handler. Returns cleanup function. */
  pushBackHandler: (handler: BackHandler) => () => void
  /** Invoke the topmost back handler. Falls through stack until one returns true. */
  goBack: () => void
}

export const BackHandlerContext = createContext<BackHandlerContextValue | null>(null)
