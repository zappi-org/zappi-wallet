/**
 * Per-mint serialization for proof-reserving cycles.
 *
 * Fee estimation runs real prepare→rollback cycles that transiently reserve
 * proofs. Two overlapping cycles on one mint (routing estimate vs direct/token
 * estimate, or an orphaned estimate vs a real send's prepare) race into
 * spurious "Not enough proofs". Coco's internal lock covers only single
 * prepare calls, not our multi-step cycles — this chain covers the cycle.
 *
 * Non-reentrant: never nest two withMintCycleLock calls on the same mint.
 * The timeout keeps a hung cycle (dead network) from bricking later sends —
 * after 30s the next entrant proceeds, degrading to today's unserialized
 * behavior instead of deadlocking.
 */
const chains = new Map<string, Promise<void>>()
const LOCK_TIMEOUT_MS = 30_000

export async function withMintCycleLock<T>(mintUrl: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(mintUrl) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  chains.set(mintUrl, tail)

  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    prev,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, LOCK_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer)

  try {
    return await fn()
  } finally {
    release()
    if (chains.get(mintUrl) === tail) chains.delete(mintUrl)
  }
}
