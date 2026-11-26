/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __ZAPPI_CHANNEL__: 'main' | 'staging' | 'nightly'
declare const __ZAPPI_INVITE_CODES__: readonly string[]

interface ImportMetaEnv {
  readonly VITE_SWAP_OUT_ENABLED?: string
  readonly VITE_SWAP_OUT_NETWORK?: string
  readonly VITE_SWAP_OUT_CHAIN_API?: string
  readonly VITE_SWAP_OUT_RELAYS?: string
  readonly VITE_SWAP_OUT_POLL_MS?: string
  readonly VITE_SWAP_OUT_POW_BITS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
