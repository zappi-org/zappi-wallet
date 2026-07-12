import type { BaseError } from '@/core/errors'
import type { Result } from '@/core/domain/result'
import type { RouteContext, RouteExecutionResult, RouteSelection } from '@/core/domain/routing'

export interface RouteExecutionUseCase {
  resolveInvoice(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<Result<string, BaseError>>

  executeRoute(
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<Result<RouteExecutionResult, BaseError>>
}
