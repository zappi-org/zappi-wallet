function normalizeMintName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function isDuplicateMintName(
  newName: string,
  currentMintUrl: string,
  allMintUrls: string[],
  getDisplayName: (url: string) => string,
): boolean {
  const normalizedName = normalizeMintName(newName)

  return allMintUrls.some((url) => {
    if (url === currentMintUrl) {
      return false
    }

    return normalizeMintName(getDisplayName(url)) === normalizedName
  })
}

export function createNextMintAlias(
  mintUrls: string[],
  existingAliases: Record<string, string> | undefined,
  buildDefaultName: (number: number) => string,
): string {
  const usedNames = new Set(
    mintUrls
      .map((url) => existingAliases?.[url])
      .filter((name): name is string => Boolean(name?.trim()))
      .map(normalizeMintName),
  )

  let nextNumber = 1
  let candidate = buildDefaultName(nextNumber)

  while (usedNames.has(normalizeMintName(candidate))) {
    nextNumber += 1
    candidate = buildDefaultName(nextNumber)
  }

  return candidate
}

export function generateMintAliases(
  mintUrls: string[],
  existingAliases: Record<string, string> | undefined,
  buildDefaultName: (number: number) => string,
): Record<string, string> {
  const aliases: Record<string, string> = {}
  const usedNames = new Set(
    mintUrls
      .map((url) => existingAliases?.[url])
      .filter((name): name is string => Boolean(name?.trim()))
      .map(normalizeMintName),
  )

  for (const url of mintUrls) {
    const existingName = existingAliases?.[url]?.trim()
    if (existingName) {
      aliases[url] = existingName
      continue
    }

    let nextNumber = 1
    let candidate = buildDefaultName(nextNumber)

    while (usedNames.has(normalizeMintName(candidate))) {
      nextNumber += 1
      candidate = buildDefaultName(nextNumber)
    }

    aliases[url] = candidate
    usedNames.add(normalizeMintName(candidate))
  }

  return aliases
}
