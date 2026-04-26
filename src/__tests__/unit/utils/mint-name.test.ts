import { describe, expect, it } from 'vitest'
import { createNextMintAlias, generateMintAliases, isDuplicateMintName } from '@/utils/mint-name'

const buildDefaultName = (number: number) => `Mint ${number}`

describe('mint-name utils', () => {
  it('picks the next available default alias without colliding with existing names', () => {
    expect(createNextMintAlias(
      ['https://mint-1', 'https://mint-2'],
      {
        'https://mint-1': 'Mint 1',
        'https://mint-2': 'Mint 3',
      },
      buildDefaultName,
    )).toBe('Mint 2')
  })

  it('preserves existing aliases and fills missing aliases with unique defaults', () => {
    expect(generateMintAliases(
      ['https://mint-1', 'https://mint-2', 'https://mint-3'],
      {
        'https://mint-1': 'Mint 1',
        'https://mint-2': 'Coffee',
      },
      buildDefaultName,
    )).toEqual({
      'https://mint-1': 'Mint 1',
      'https://mint-2': 'Coffee',
      'https://mint-3': 'Mint 2',
    })
  })

  it('detects duplicate names case-insensitively while ignoring the current mint', () => {
    const getDisplayName = (url: string) => {
      if (url === 'https://mint-1') {
        return 'Alpha'
      }

      return 'BeTa'
    }

    expect(isDuplicateMintName(
      ' beta ',
      'https://mint-1',
      ['https://mint-1', 'https://mint-2'],
      getDisplayName,
    )).toBe(true)

    expect(isDuplicateMintName(
      ' alpha ',
      'https://mint-1',
      ['https://mint-1', 'https://mint-2'],
      getDisplayName,
    )).toBe(false)
  })
})
