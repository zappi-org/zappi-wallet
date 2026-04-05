/**
 * useServiceRegistry — ServiceRegistry accessor hook
 *
 * ServiceProvider 내부에서만 호출 가능.
 * hooks/에서는 driving port 인터페이스 + store만 import.
 */

import { useContext } from 'react'
import { ServiceContext } from './service-context-value'
import type { ServiceRegistry } from '@/composition/types'

export function useServiceRegistry(): ServiceRegistry {
  const registry = useContext(ServiceContext)
  if (!registry) {
    throw new Error('useServiceRegistry must be used within ServiceProvider')
  }
  return registry
}
