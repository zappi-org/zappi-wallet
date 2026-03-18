import { useContext } from 'react'
import { BackHandlerContext } from '@/contexts/back-handler-context'

export function useBackHandler() {
  const ctx = useContext(BackHandlerContext)
  if (!ctx) throw new Error('useBackHandler must be used within BackHandlerProvider')
  return ctx
}
