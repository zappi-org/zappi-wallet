/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __ZAPPI_CHANNEL__: 'main' | 'staging' | 'nightly'
declare const __ZAPPI_INVITE_CODES__: readonly string[]

interface ImportMetaEnv {
  readonly VITE_ONCHAIN_PAYOUT_ENABLED?: string
  readonly VITE_ONCHAIN_PAYOUT_NETWORK?: string
  readonly VITE_ONCHAIN_PAYOUT_CHAIN_API?: string
  readonly VITE_ONCHAIN_PAYOUT_RELAYS?: string
  readonly VITE_ONCHAIN_PAYOUT_POLL_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
