import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// bc-ur's transitive cborg dependency has no "main" in its package.json
// exports map, which vite/vitest can't resolve — mock it out so the real
// QRCodeDisplay module (and its isUri/overCap policy) can still be imported
// and exercised, instead of mocking QRCodeDisplay itself (as other tests do).
vi.mock('@gandlaf21/bc-ur', () => ({
  UR: { fromBuffer: () => ({}) },
  UREncoder: class {
    fragmentsLength = 1
    nextPart() {
      return 'ur:mock/frame'
    }
  },
}))

import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'

// The animated wrapper renders a normal-flow "N / total" counter; the static
// wrapper renders none. Presence/absence of that text is how we tell the two
// render modes apart from the outside without reaching into internals.
const FRAME_COUNTER = /^\d+ \/ \d+$/

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('QRCodeDisplay — bitcoin: URI stays scannable (D3 policy)', () => {
  it('renders a short bitcoin: URI statically (below both thresholds)', () => {
    const value = `bitcoin:${'a'.repeat(50)}`
    const { queryByText } = render(<QRCodeDisplay value={value} />)
    expect(queryByText(FRAME_COUNTER)).not.toBeInTheDocument()
  })

  it('keeps a bitcoin: URI static past the generic 500-char animated threshold', () => {
    const value = `bitcoin:${'a'.repeat(600)}` // > ANIMATED_THRESHOLD, < 2500 hard cap
    const { queryByText } = render(<QRCodeDisplay value={value} />)
    expect(queryByText(FRAME_COUNTER)).not.toBeInTheDocument()
  })

  it('falls back to animated UR past the 2500-char hard cap and warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const value = `bitcoin:${'a'.repeat(2500)}` // length > 2500
    const { getByText } = render(<QRCodeDisplay value={value} />)
    expect(getByText(FRAME_COUNTER)).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('bitcoin: URI exceeds static cap'),
    )
  })

  it('preserves the existing 500-char animated threshold for non-URI values', () => {
    const value = 'a'.repeat(600)
    const { getByText } = render(<QRCodeDisplay value={value} />)
    expect(getByText(FRAME_COUNTER)).toBeInTheDocument()
  })
})
