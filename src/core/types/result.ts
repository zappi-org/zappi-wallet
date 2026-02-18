/**
 * Result type for operations that can fail
 * Inspired by Rust's Result type
 */

export type Result<T, E> = Ok<T, E> | Err<T, E>

export class Ok<T, E> {
  readonly value: T

  constructor(value: T) {
    this.value = value
  }

  isOk(): this is Ok<T, E> {
    return true
  }

  isErr(): this is Err<T, E> {
    return false
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value))
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok(this.value)
  }

  unwrap(): T {
    return this.value
  }

  unwrapOr(_defaultValue: T): T {
    return this.value
  }

  unwrapErr(): never {
    throw new Error('Called unwrapErr on Ok')
  }
}

export class Err<T, E> {
  readonly error: E

  constructor(error: E) {
    this.error = error
  }

  isOk(): this is Ok<T, E> {
    return false
  }

  isErr(): this is Err<T, E> {
    return true
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err(this.error)
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error))
  }

  unwrap(): never {
    throw this.error
  }

  unwrapOr(defaultValue: T): T {
    return defaultValue
  }

  unwrapErr(): E {
    return this.error
  }
}

/**
 * Create an Ok result
 */
export function ok<T, E = never>(value: T): Result<T, E> {
  return new Ok(value)
}

/**
 * Create an Err result
 */
export function err<T = never, E = unknown>(error: E): Result<T, E> {
  return new Err(error)
}
