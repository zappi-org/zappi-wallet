import QrScanner from '@agicash/qr-scanner'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

/**
 * The QR decoder, configured once for the whole app.
 *
 * It decodes in WebAssembly rather than in JavaScript, which is what makes it
 * work on hardened browsers: GrapheneOS's Vanadium blocks the JavaScript JIT by
 * default, and an interpreted decoder cannot finish a frame in time — the camera
 * previews fine and nothing is ever recognised. Those devices also have no
 * Google Play Services, so the browser's own BarcodeDetector is unavailable and
 * there is nothing else to fall back to.
 *
 * The binary ships with the app instead of being fetched from the package's
 * default CDN: a wallet must not announce a scan to a third party, and the
 * scanner has to work offline.
 */
QrScanner.configureWasm({ locateFile: () => zxingReaderWasmUrl })

export { QrScanner }
export { CameraNotFoundError, CameraPermissionError } from '@agicash/qr-scanner'
export type { ScanRegion, ScanResult } from '@agicash/qr-scanner'
