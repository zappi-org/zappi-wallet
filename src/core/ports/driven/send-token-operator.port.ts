export interface SendTokenOperator {
  rollbackSendToken(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
}
