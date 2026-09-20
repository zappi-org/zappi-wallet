export class ChatCapacityError extends Error {
  constructor(readonly kind: 'storage' | 'receive') {
    super(
      kind === 'storage'
        ? 'Chat storage limit reached'
        : 'Chat receive queue is full'
    )
    this.name = 'ChatCapacityError'
  }
}
