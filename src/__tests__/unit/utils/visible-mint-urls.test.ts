import { describe, expect, it } from 'vitest'
import { visibleMintUrls } from '@/utils/visible-mint-urls'

/**
 * npubcash mints deposits on the mint the server picked. Those funds land in
 * balance.byMint but not in settings.mints, so the wallet total moved while
 * every mint list kept showing the old mint at 0.
 */
describe('visibleMintUrls', () => {
  it('appends a funded mint the user never added', () => {
    expect(visibleMintUrls(['https://hanbit.example'], { 'https://hanbit.example': 0, 'https://testnut.example': 610 }))
      .toEqual(['https://hanbit.example', 'https://testnut.example'])
  })

  it('keeps the user list first and in order', () => {
    const urls = visibleMintUrls(['https://b.example', 'https://a.example'], { 'https://c.example': 5 })
    expect(urls).toEqual(['https://b.example', 'https://a.example', 'https://c.example'])
  })

  it('does not duplicate notation variants of the same mint', () => {
    expect(visibleMintUrls(['https://Mint.example/'], { 'https://mint.example': 10 }))
      .toEqual(['https://Mint.example/'])
    expect(visibleMintUrls(['https://mint.example'], { 'https://mint.example:443': 10 }))
      .toEqual(['https://mint.example'])
  })

  it('keeps unlisted zero-balance mints out', () => {
    expect(visibleMintUrls(['https://a.example'], { 'https://a.example': 0, 'https://seen-before.example': 0 }))
      .toEqual(['https://a.example'])
  })

  it('tolerates missing balance data and a repeated entry in the user list', () => {
    expect(visibleMintUrls(['https://a.example'], undefined)).toEqual(['https://a.example'])
    expect(visibleMintUrls(['https://a.example/', 'https://a.example'], {})).toEqual([
      'https://a.example/',
    ])
  })
})
