/**
 * Mint info data from /v1/info endpoint (NUT-06)
 */
export interface MintInfoData {
  name?: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: Array<{ method: string; info: string }>
  nuts?: Record<string, unknown>
  motd?: string
  icon_url?: string
  units?: string[]
}
