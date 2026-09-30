import { nip19 } from 'nostr-tools'
import type { MostroUnavailableReason } from '@/core/domain/mostro'

export interface MostroConfig {
  /** Mostro instance pubkey (hex). */
  mostroPubkeyHex: string
  /** Relay URLs the client connects to. */
  relays: string[]
}

export type MostroConfigResult =
  | { ok: true; value: MostroConfig }
  | { ok: false; reason: MostroUnavailableReason }

interface MostroEnv {
  VITE_ZAPPI_MOSTRO_INSTANCE?: string
  VITE_ZAPPI_MOSTRO_RELAYS?: string
}

const MAX_RELAYS = 12

/**
 * Read the Mostro instance config from public env.
 *
 * Unset instance = `not_configured` (feature disabled). Malformed values =
 * `invalid_config`.
 */
export function readMostroConfig(
  env: MostroEnv = import.meta.env as unknown as MostroEnv,
): MostroConfigResult {
  const rawInstance = env.VITE_ZAPPI_MOSTRO_INSTANCE?.trim()
  if (!rawInstance) {
    return { ok: false, reason: 'not_configured' }
  }

  const mostroPubkeyHex = parseInstancePubkey(rawInstance)
  if (!mostroPubkeyHex) {
    return { ok: false, reason: 'invalid_config' }
  }

  const relays = parseRelayList(env.VITE_ZAPPI_MOSTRO_RELAYS)
  if (relays.length === 0) {
    return { ok: false, reason: 'invalid_config' }
  }

  return { ok: true, value: { mostroPubkeyHex, relays } }
}

function parseInstancePubkey(input: string): string | null {
  const trimmed = input.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (!trimmed.startsWith('npub1')) return null
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== 'npub') return null
    return decoded.data
  } catch {
    return null
  }
}

function parseRelayList(input?: string): string[] {
  if (!input) return []
  const relays = input
    .split(',')
    .map(normalizeRelayUrl)
    .filter((relay): relay is string => relay !== null)
  return [...new Set(relays)].slice(0, MAX_RELAYS)
}

function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null
    if (url.username || url.password || url.hash) return null
    return url.href
  } catch {
    return null
  }
}
