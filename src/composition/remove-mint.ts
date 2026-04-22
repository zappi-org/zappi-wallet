import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

interface RemoveMintArtifactsDeps {
  txRepo: TransactionRepository
  removeMintFromSdk: (mintUrl: string) => Promise<void>
  clearLocalMintData: (mintUrl: string) => Promise<void>
  now?: () => number
}

function normalizeMintUrl(mintUrl: string): string {
  return mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl
}

function isSameMintUrl(left: string, right: string): boolean {
  return normalizeMintUrl(left) === normalizeMintUrl(right)
}

export async function removeMintArtifacts(
  deps: RemoveMintArtifactsDeps,
  mintUrl: string,
): Promise<void> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl)
  const now = deps.now?.() ?? Date.now()

  const allTransactions = await deps.txRepo.findAll()
  const pendingTransactions = allTransactions.filter(
    (tx) => tx.status === 'pending' && isSameMintUrl(tx.accountId, normalizedMintUrl),
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
