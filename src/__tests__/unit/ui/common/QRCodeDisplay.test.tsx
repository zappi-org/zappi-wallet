import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// bc-ur's transitive cborg dependency has no "main" in its package.json
// exports map, which vite/vitest can't resolve — mock it out so the real
// QRCodeDisplay module can still be imported and exercised, instead of
// mocking QRCodeDisplay itself (as other tests do).
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

describe('QRCodeDisplay — static vs animated threshold', () => {
  it('renders a short value statically, bitcoin: URIs included', () => {
    const value = `bitcoin:${'a'.repeat(50)}`
    const { queryByText } = render(<QRCodeDisplay value={value} />)
    expect(queryByText(FRAME_COUNTER)).not.toBeInTheDocument()
  })

  // A dense static QR doesn't scan reliably at phone size, so bitcoin: URIs
  // animate past the threshold exactly like any other long payload.
  it('animates a bitcoin: URI past the 500-char threshold', () => {
    const value = `bitcoin:${'a'.repeat(600)}`
    const { getByText } = render(<QRCodeDisplay value={value} />)
    expect(getByText(FRAME_COUNTER)).toBeInTheDocument()
  })

  it('animates a long non-URI value past the same threshold', () => {
    const value = 'a'.repeat(600)
    const { getByText } = render(<QRCodeDisplay value={value} />)
    expect(getByText(FRAME_COUNTER)).toBeInTheDocument()
  })
})
