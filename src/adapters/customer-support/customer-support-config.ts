import { nip19 } from 'nostr-tools'

export interface CustomerSupportRelayConfig {
  bootstrap: [string, ...string[]]
  write: string[]
  read: string[]
  dm: string[]
  discovery: string[]
}

export interface CustomerSupportConfig {
  agentPubkey: string
  relays: CustomerSupportRelayConfig
  attachments: CustomerSupportAttachmentConfig
}

export interface CustomerSupportAttachmentConfig {
  servers: string[]
  maxCount: number
  maxSizeBytes: number
}

export type CustomerSupportConfigResult =
  | { ok: true; value: CustomerSupportConfig }
  | { ok: false; reason: 'not_configured' | 'invalid_config' }

interface PublicSupportEnv {
  VITE_ZAPPI_SUPPORT_AGENT_NPUB?: string
  VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS?: string
  VITE_ZAPPI_SUPPORT_WRITE_RELAYS?: string
  VITE_ZAPPI_SUPPORT_READ_RELAYS?: string
  VITE_ZAPPI_SUPPORT_DM_RELAYS?: string
  VITE_ZAPPI_SUPPORT_DISCOVERY_RELAYS?: string
  VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS?: string
  VITE_ZAPPI_SUPPORT_MAX_ATTACHMENT_BYTES?: string
}

const MAX_SUPPORT_RELAYS = 12
const MAX_SUPPORT_BLOSSOM_SERVERS = 6
const DEFAULT_ATTACHMENT_MAX_COUNT = 3
const DEFAULT_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024

export function readCustomerSupportConfig(
  env: PublicSupportEnv = import.meta.env as unknown as PublicSupportEnv,
): CustomerSupportConfigResult {
  const rawAgent = env.VITE_ZAPPI_SUPPORT_AGENT_NPUB?.trim()
  const rawBootstrap = env.VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS?.trim()

  if (!rawAgent || !rawBootstrap) {
    return { ok: false, reason: 'not_configured' }
  }

  const agentPubkey = parsePubkey(rawAgent)
  const bootstrap = parseRelayList(rawBootstrap)
  if (!agentPubkey || !bootstrap || bootstrap.length === 0) {
    return { ok: false, reason: 'invalid_config' }
  }

  const write = parseRelayList(env.VITE_ZAPPI_SUPPORT_WRITE_RELAYS) ?? bootstrap
  const read = parseRelayList(env.VITE_ZAPPI_SUPPORT_READ_RELAYS) ?? bootstrap
  const dm = parseRelayList(env.VITE_ZAPPI_SUPPORT_DM_RELAYS) ?? read
  const discovery = parseRelayList(env.VITE_ZAPPI_SUPPORT_DISCOVERY_RELAYS) ?? bootstrap
  const blossomServers = parseServerList(env.VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS)
  const maxSizeBytes = parsePositiveInteger(
    env.VITE_ZAPPI_SUPPORT_MAX_ATTACHMENT_BYTES,
    DEFAULT_ATTACHMENT_MAX_SIZE_BYTES,
  )

  if (write.length === 0 || read.length === 0 || dm.length === 0 || discovery.length === 0) {
    return { ok: false, reason: 'invalid_config' }
  }

  return {
    ok: true,
    value: {
      agentPubkey,
      relays: {
        bootstrap: toNonEmpty(bootstrap),
        write,
        read,
        dm,
        discovery,
      },
      attachments: {
        servers: blossomServers ?? [],
        maxCount: DEFAULT_ATTACHMENT_MAX_COUNT,
        maxSizeBytes,
      },
    },
  }
}

function parsePubkey(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('npub1')) return null

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== 'npub') return null
    return decoded.data
  } catch {
    return null
  }
}

function parseRelayList(input?: string): string[] | null {
  if (input === undefined) return null
  const relays = input
    .split(',')
    .map((relay) => normalizeRelayUrl(relay))
    .filter((relay): relay is string => relay !== null)

  return [...new Set(relays)].slice(0, MAX_SUPPORT_RELAYS)
}

function parseServerList(input?: string): string[] | null {
  if (input === undefined) return null
  const servers = input
    .split(',')
    .map((server) => normalizeHttpServerUrl(server))
    .filter((server): server is string => server !== null)

  return [...new Set(servers)].slice(0, MAX_SUPPORT_BLOSSOM_SERVERS)
}

function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'wss:') return null
    if (url.username || url.password || url.hash) return null
    return url.href
  } catch {
    return null
  }
}

function normalizeHttpServerUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    if (url.username || url.password || url.hash || url.search) return null
    return url.href.replace(/\/+$/, '')
  } catch {
    return null
  }
}

function parsePositiveInteger(input: string | undefined, fallback: number): number {
  if (!input) return fallback
  const parsed = Number.parseInt(input, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function toNonEmpty(relays: string[]): [string, ...string[]] {
  return [relays[0]!, ...relays.slice(1)]
}
