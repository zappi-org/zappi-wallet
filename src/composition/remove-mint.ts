import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { isSameMintUrl } from '@/core/domain/mint-url'

interface RemoveMintArtifactsDeps {
  txRepo: TransactionRepository
  removeMintFromSdk: (mintUrl: string) => Promise<void>
  clearLocalMintData: (mintUrl: string) => Promise<void>
  now?: () => number
}

export async function removeMintArtifacts(
  deps: RemoveMintArtifactsDeps,
  mintUrl: string,
): Promise<void> {
  // Wire/storage paths (SDK removal, local cleanup) preserve the existing slash-strip
  // semantics — mintUrlKey (lowercasing, etc.) is comparison-only and must not leak into storage keys.
  const normalizedMintUrl = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl
  const now = deps.now?.() ?? Date.now()

  const allTransactions = await deps.txRepo.findAll()
  const pendingTransactions = allTransactions.filter(
    (tx) => tx.status === 'pending' && isSameMintUrl(tx.accountId, mintUrl),
  )

  await Promise.all(
    pendingTransactions.map((tx) =>
      deps.txRepo.update(tx.id, {
        status: 'failed',
        completedAt: now,
        metadata: {
          ...(tx.metadata ?? {}),
          mintRemoved: true,
        },
      }),
    ),
  )

  await deps.removeMintFromSdk(normalizedMintUrl)
  await deps.clearLocalMintData(normalizedMintUrl)
}
