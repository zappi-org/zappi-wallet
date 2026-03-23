/**
 * Check if a mint name is already used by another mint.
 */
export function isDuplicateMintName(
  newName: string,
  currentMintUrl: string,
  allMintUrls: string[],
  getDisplayName: (url: string) => string,
): boolean {
  return allMintUrls.some(
    (url) => url !== currentMintUrl && getDisplayName(url).toLowerCase() === newName.toLowerCase()
  )
}
