import { mintUrlKey } from '@/core/domain/mint-url'

/**
 * Mints worth rendering: the user's own list first, then any mint that holds
 * funds but was never added. npubcash deposits mint on the mint the *server*
 * picked, so without this the deposit lands in `balance.byMint` (and the total)
 * while every list keeps showing the old mint at 0 — money that looks lost.
 *
 * Unlisted mints with no balance stay out: coco remembers mints it has ever
 * seen, and surfacing all of them would bury the curated list.
 */
export function visibleMintUrls(
  settingsMints: readonly string[],
  byMint: Record<string, number> | undefined,
): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const add = (url: string) => {
    const key = mintUrlKey(url)
    if (seen.has(key)) return
    seen.add(key)
    urls.push(url)
  }

  settingsMints.forEach(add)
  for (const [url, balance] of Object.entries(byMint ?? {})) {
    if (balance > 0) add(url)
  }
  return urls
}
