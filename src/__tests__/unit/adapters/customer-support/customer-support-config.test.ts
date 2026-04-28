import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { readCustomerSupportConfig } from '@/adapters/customer-support/customer-support-config'

describe('readCustomerSupportConfig', () => {
  const agentPubkey = 'a'.repeat(64)
  const agentNpub = nip19.npubEncode(agentPubkey)

  it('returns not_configured when public support config is absent', () => {
    expect(readCustomerSupportConfig({})).toEqual({
      ok: false,
      reason: 'not_configured',
    })
  })

  it('normalizes valid public config and never falls back to wallet relays', () => {
    const result = readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: agentNpub,
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'wss://relay-one.example,wss://relay-two.example/',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.agentPubkey).toBe(agentPubkey)
    expect(result.value.relays.bootstrap).toEqual([
      'wss://relay-one.example/',
      'wss://relay-two.example/',
    ])
    expect(result.value.relays.write).toEqual(result.value.relays.bootstrap)
    expect(result.value.relays.read).toEqual(result.value.relays.bootstrap)
    expect(result.value.relays.dm).toEqual(result.value.relays.bootstrap)
    expect(result.value.relays.discovery).toEqual(result.value.relays.bootstrap)
    expect(result.value.attachments).toEqual({
      servers: [],
      maxCount: 3,
      maxSizeBytes: 10 * 1024 * 1024,
    })
  })

  it('enables attachment storage only from explicit HTTPS Blossom config', () => {
    const result = readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: agentNpub,
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'wss://relay.example',
      VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS: 'https://blossom-one.example/,http://not-allowed.example,https://blossom-two.example/path/',
      VITE_ZAPPI_SUPPORT_MAX_ATTACHMENT_BYTES: '12345',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.attachments).toEqual({
      servers: ['https://blossom-one.example', 'https://blossom-two.example/path'],
      maxCount: 3,
      maxSizeBytes: 12345,
    })
  })

  it('rejects private-key-like or non-relay config', () => {
    expect(readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: 'nsec1notallowed',
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'wss://relay.example',
    })).toEqual({
      ok: false,
      reason: 'invalid_config',
    })

    expect(readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: agentPubkey,
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'wss://relay.example',
    })).toEqual({
      ok: false,
      reason: 'invalid_config',
    })

    expect(readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: agentNpub,
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'https://relay.example',
    })).toEqual({
      ok: false,
      reason: 'invalid_config',
    })
  })
})
