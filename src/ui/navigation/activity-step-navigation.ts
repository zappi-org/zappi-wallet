import { createContext, useContext } from 'react'

export interface ActivityStepNavigation {
  stepDepth: number
  pushStep: () => void
  popStep: () => void
}

export const ActivityStepNavigationContext = createContext<ActivityStepNavigation>({
  stepDepth: 0,
  pushStep: () => {},
  popStep: () => {},
})

/** Makes nested in-screen pages participate in Stackflow/browser history. */
export function useActivityStepNavigation(): ActivityStepNavigation {
  return useContext(ActivityStepNavigationContext)
}
