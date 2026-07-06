import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { isSameMintUrl } from '@/utils/url'

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
  // 와이어/저장 경로(SDK 제거·로컬 정리)는 기존 slash-strip 의미를 보존한다 —
  // mintUrlKey(소문자화 등)는 비교 전용이며 저장 키로 새어나가면 안 된다 (Phase 2)
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
