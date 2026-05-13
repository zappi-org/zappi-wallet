import type { BaseError } from '@/core/errors'
import type { Result } from '@/core/types'
import type { RouteContext, RouteExecutionResult, RouteSelection } from '@/core/domain/routing'

export interface RouteExecutionUseCase {
  executeRoute(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<Result<RouteExecutionResult, BaseError>>
}
