/**
 * ServiceProvider — UseCase 포트를 React 컴포넌트 트리에 제공
 *
 * bootstrap.ts가 생성한 ServiceRegistry를 Context로 주입.
 */

import type { ReactNode } from 'react'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { ServiceContext } from './service-context-value'

export interface ServiceProviderProps {
  registry: ServiceRegistry
  children: ReactNode
}

export function ServiceProvider({ registry, children }: ServiceProviderProps) {
  return (
    <ServiceContext.Provider value={registry}>
      {children}
    </ServiceContext.Provider>
  )
}
