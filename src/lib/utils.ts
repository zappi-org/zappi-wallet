import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-display', 'text-amount-lg', 'text-amount',
        'text-heading', 'text-title', 'text-title-sm', 'text-subtitle',
        'text-body', 'text-body-bold',
        'text-caption', 'text-label', 'text-overline',
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Timeout error class
export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// Wrap a promise with a timeout
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  // Prevent unhandled rejection if timeout wins the race
  promise.catch(() => {})
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs)
    )
  ]);
}
