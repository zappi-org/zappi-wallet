/**
 * InputRouterUseCase — QR/입력 문자열 분류 driving port
 */

import type { ParsedInput } from '@/core/services/input-router.service'

export interface InputRouterUseCase {
  classify(raw: string): Promise<ParsedInput>
}
