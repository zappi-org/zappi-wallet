import { nip19 } from 'nostr-tools'
import {
  SUPPORT_AGENT_NPUB,
  SUPPORT_BLOSSOM_SERVERS,
  SUPPORT_BOOTSTRAP_RELAYS,
  SUPPORT_DEFAULT_MAX_ATTACHMENT_BYTES,
  SUPPORT_DEFAULT_MAX_ATTACHMENT_COUNT,
  SUPPORT_DISCOVERY_RELAYS,
} from './customer-support-defaults'

export interface CustomerSupportRelayConfig {
  bootstrap: [string, ...string[]]
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
  VITE_ZAPPI_SUPPORT_DISCOVERY_RELAYS?: string
  VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS?: string
  VITE_ZAPPI_SUPPORT_MAX_ATTACHMENT_BYTES?: string
}

const MAX_SUPPORT_RELAYS = 12
const MAX_SUPPORT_BLOSSOM_SERVERS = 6

export function readCustomerSupportConfig(
  env: PublicSupportEnv = import.meta.env as unknown as PublicSupportEnv,
): CustomerSupportConfigResult {
  const rawAgent = env.VITE_ZAPPI_SUPPORT_AGENT_NPUB?.trim() || SUPPORT_AGENT_NPUB
  const rawBootstrap =
    env.VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS?.trim() || SUPPORT_BOOTSTRAP_RELAYS.join(',')

  const agentPubkey = parsePubkey(rawAgent)
  const bootstrap = parseRelayList(rawBootstrap)
  if (!agentPubkey || !bootstrap || bootstrap.length === 0) {
    return { ok: false, reason: 'invalid_config' }
  }

  const discovery =
    parseRelayList(env.VITE_ZAPPI_SUPPORT_DISCOVERY_RELAYS) ??
    parseRelayList(SUPPORT_DISCOVERY_RELAYS.join(',')) ??
    bootstrap
  if (discovery.length === 0) {
    return { ok: false, reason: 'invalid_config' }
  }

  const blossomServers =
    parseServerList(env.VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS) ??
    parseServerList(SUPPORT_BLOSSOM_SERVERS.join(',')) ??
    []
  const maxSizeBytes = parsePositiveInteger(
    env.VITE_ZAPPI_SUPPORT_MAX_ATTACHMENT_BYTES,
    SUPPORT_DEFAULT_MAX_ATTACHMENT_BYTES,
  )

  return {
    ok: true,
    value: {
      agentPubkey,
      relays: {
        bootstrap: toNonEmpty(bootstrap),
        discovery,
      },
      attachments: {
        servers: blossomServers,
        maxCount: SUPPORT_DEFAULT_MAX_ATTACHMENT_COUNT,
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
