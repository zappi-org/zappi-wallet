export type Unit = 'sat' | 'msat' | 'usd' | 'eur'

export interface Amount {
  readonly value: bigint
  readonly unit: Unit
}

export function sat(value: number | bigint): Amount {
  return { value: BigInt(value), unit: 'sat' }
}

export function msat(value: number | bigint): Amount {
  return { value: BigInt(value), unit: 'msat' }
}

export function add(a: Amount, b: Amount): Amount {
  if (a.unit !== b.unit) throw new Error(`Unit mismatch: ${a.unit} + ${b.unit}`)
  return { value: a.value + b.value, unit: a.unit }
}

export function subtract(a: Amount, b: Amount): Amount {
  if (a.unit !== b.unit) throw new Error(`Unit mismatch: ${a.unit} - ${b.unit}`)
  return { value: a.value - b.value, unit: a.unit }
}

export function isZero(a: Amount): boolean {
  return a.value === 0n
}

export function toNumber(a: Amount): number {
  return Number(a.value)
}
