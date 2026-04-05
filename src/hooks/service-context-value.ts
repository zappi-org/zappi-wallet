/**
 * ServiceContext value — React Context 정의 (별도 파일)
 *
 * react-refresh 규칙: Context와 Component를 같은 파일에 두면 안 됨.
 */

import { createContext } from 'react'
import type { ServiceRegistry } from '@/composition/types'

export const ServiceContext = createContext<ServiceRegistry | null>(null)
