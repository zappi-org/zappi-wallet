import type { DomainEvent } from './domain-events'

type EventType = DomainEvent['type']
type EventOfType<T extends EventType> = Extract<DomainEvent, { type: T }>
type Handler<T extends EventType> = (event: EventOfType<T>) => void

export interface EventBus {
  emit(event: DomainEvent): void
  on<T extends EventType>(type: T, handler: Handler<T>): () => void
  off<T extends EventType>(type: T, handler: Handler<T>): void
}

export function createEventBus(): EventBus {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const listeners = new Map<EventType, Set<Function>>()

  return {
    emit(event: DomainEvent) {
      const handlers = listeners.get(event.type)
      if (!handlers) return
      for (const handler of handlers) {
        handler(event)
      }
    },

    on<T extends EventType>(type: T, handler: Handler<T>): () => void {
      if (!listeners.has(type)) {
        listeners.set(type, new Set())
      }
      listeners.get(type)!.add(handler)
      return () => this.off(type, handler)
    },

    off<T extends EventType>(type: T, handler: Handler<T>) {
      listeners.get(type)?.delete(handler)
    },
  }
}
