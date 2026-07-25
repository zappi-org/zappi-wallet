import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// bc-ur's transitive cborg dependency has no "main" in its package.json
// exports map, which vite/vitest can't resolve — mock it out so the real
// QRCodeDisplay module can still be imported and exercised, instead of
// mocking QRCodeDisplay itself (as other tests do).
vi.mock('@gandlaf21/bc-ur', () => ({
  UR: { fromBuffer: () => ({}) },
  UREncoder: class {
    fragmentsLength = 3
    #n = 0
    nextPart() {
      return `ur:mock/frame-${this.#n++}`
    }
  },
}))

// The payload actually handed to the QR is the observable that separates the
// two render modes: static passes the value straight through, animated passes
// UR frames that keep changing. Surface it as a data attribute.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}))

import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'

const qrValue = (el: HTMLElement) => el.getAttribute('data-value')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('QRCodeDisplay — static vs animated threshold', () => {
  it('renders a short value statically, bitcoin: URIs included', () => {
    const value = `bitcoin:${'a'.repeat(50)}`
    const { getByTestId } = render(<QRCodeDisplay value={value} />)
    expect(qrValue(getByTestId('qr'))).toBe(value)
  })

  // A dense static QR doesn't scan reliably at phone size, so bitcoin: URIs
  // animate past the threshold exactly like any other long payload.
  it('animates a bitcoin: URI past the 500-char threshold', () => {
    const value = `bitcoin:${'a'.repeat(600)}`
    const { getByTestId } = render(<QRCodeDisplay value={value} />)
    expect(qrValue(getByTestId('qr'))).toMatch(/^ur:mock\/frame-/)
  })

  it('animates a long non-URI value past the same threshold', () => {
    const value = 'a'.repeat(600)
    const { getByTestId } = render(<QRCodeDisplay value={value} />)
    expect(qrValue(getByTestId('qr'))).toMatch(/^ur:mock\/frame-/)
  })

  // Frame cycling is the data channel — without it a multipart payload can
  // never be decoded, so it is asserted directly rather than via a counter.
  it('keeps emitting new UR frames while mounted', () => {
    vi.useFakeTimers()
    const { getByTestId } = render(<QRCodeDisplay value={'a'.repeat(600)} />)
    const first = qrValue(getByTestId('qr'))

    act(() => {
      vi.advanceTimersByTime(250)
    })
    const second = qrValue(getByTestId('qr'))
    expect(second).not.toBe(first)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(qrValue(getByTestId('qr'))).not.toBe(second)
  })

  it('renders no frame counter alongside an animated QR', () => {
    const { queryByText } = render(<QRCodeDisplay value={'a'.repeat(600)} />)
    expect(queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument()
  })
})
