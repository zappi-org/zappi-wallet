import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { ScanResult } from 'qr-scanner'

// Capture the scan callback passed to QrScannerLib constructor
let capturedScanCallback: ((result: ScanResult) => void) | null = null

vi.mock('qr-scanner', () => {
  class MockQrScanner {
    constructor(
      _video: HTMLVideoElement,
      onScan: (result: ScanResult) => void,
    ) {
      capturedScanCallback = onScan
    }
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn()
    destroy = vi.fn()
    setInversionMode = vi.fn()
    static hasCamera = vi.fn().mockResolvedValue(true)
  }
  return { default: MockQrScanner }
})

vi.mock('@gandlaf21/bc-ur', () => ({
  URDecoder: vi.fn(),
}))

// Stable reference to prevent useEffect re-runs from changing `t` identity
const stableT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}))

import { QrScanner } from '@/ui/components/common/QrScanner'

function scanResult(data: string): ScanResult {
  return { data } as ScanResult
}

describe('QrScanner deduplication', () => {
  let onScan: ReturnType<typeof vi.fn<(result: string) => void>>

  beforeEach(() => {
    cleanup()
    capturedScanCallback = null
    onScan = vi.fn()
  })

  async function renderScanner() {
    await act(async () => {
      render(<QrScanner onScan={onScan} active={true} />)
    })
    expect(capturedScanCallback).not.toBeNull()
  }

  it('should call onScan once for repeated identical data', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    capturedScanCallback!(scanResult('lnbc1000n1test'))
    capturedScanCallback!(scanResult('lnbc1000n1test'))

    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('lnbc1000n1test')
  })

  it('should call onScan again when data changes', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1first'))
    capturedScanCallback!(scanResult('lnbc1000n1second'))

    expect(onScan).toHaveBeenCalledTimes(2)
    expect(onScan).toHaveBeenNthCalledWith(1, 'lnbc1000n1first')
    expect(onScan).toHaveBeenNthCalledWith(2, 'lnbc1000n1second')
  })

  it('should allow same data after a different QR is scanned', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('qr-a'))
    capturedScanCallback!(scanResult('qr-b'))
    capturedScanCallback!(scanResult('qr-a'))

    expect(onScan).toHaveBeenCalledTimes(3)
  })

  it('should ignore empty scan results', async () => {
    await renderScanner()

    capturedScanCallback!({ data: '' } as ScanResult)
    capturedScanCallback!(null as unknown as ScanResult)
    capturedScanCallback!({ data: undefined } as unknown as ScanResult)

    expect(onScan).not.toHaveBeenCalled()
  })

  it('should reset dedup state on remount', async () => {
    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    expect(onScan).toHaveBeenCalledTimes(1)

    // Unmount and remount
    await act(async () => {
      cleanup()
    })
    capturedScanCallback = null
    onScan.mockClear()

    await renderScanner()

    capturedScanCallback!(scanResult('lnbc1000n1test'))
    expect(onScan).toHaveBeenCalledTimes(1)
  })
})
