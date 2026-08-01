/// <reference lib="webworker" />

import {
  readBarcodes,
  setZXingModuleOverrides,
  type ReaderOptions,
} from 'zxing-wasm/reader'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

interface ConfigureMessage {
  type: 'configure'
  options?: Partial<ReaderOptions>
}

interface DecodeMessage {
  type: 'decode'
  imageData: Blob | ArrayBuffer | Uint8Array | ImageData
}

type IncomingMessage = ConfigureMessage | DecodeMessage

const DEFAULT_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryInvert: true,
  tryRotate: true,
  tryDenoise: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
}

// Bundle the version-matched decoder for offline PWA use.
setZXingModuleOverrides({ locateFile: () => zxingReaderWasmUrl })

let options: ReaderOptions = { ...DEFAULT_OPTIONS }
const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data

  if (message.type === 'configure') {
    options = { ...DEFAULT_OPTIONS, ...message.options, formats: ['QRCode'] }
    return
  }

  try {
    const found = await readBarcodes(message.imageData, options)
    workerScope.postMessage({
      type: 'result',
      results: found
        .filter((result) => result.isValid)
        .map((result) => ({
          data: result.text,
          cornerPoints: [
            result.position.topLeft,
            result.position.topRight,
            result.position.bottomRight,
            result.position.bottomLeft,
          ],
        })),
    })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

workerScope.postMessage({ type: 'ready' })
