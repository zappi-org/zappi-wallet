import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { readCustomerSupportConfig } from '@/adapters/customer-support/customer-support-config'
import {
  SUPPORT_AGENT_NPUB,
  SUPPORT_BLOSSOM_SERVERS,
  SUPPORT_BOOTSTRAP_RELAYS,
} from '@/adapters/customer-support/customer-support-defaults'

describe('readCustomerSupportConfig', () => {
  const agentPubkey = 'a'.repeat(64)
  const agentNpub = nip19.npubEncode(agentPubkey)

  it('falls back to hardcoded defaults when env is empty', () => {
    const result = readCustomerSupportConfig({})

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expectedAgent = nip19.decode(SUPPORT_AGENT_NPUB)
    expect(expectedAgent.type).toBe('npub')
    expect(result.value.agentPubkey).toBe(expectedAgent.data)
    expect(result.value.relays.bootstrap.length).toBeGreaterThan(0)
    for (const url of result.value.relays.bootstrap) {
      expect(SUPPORT_BOOTSTRAP_RELAYS.map((r) => `${r}/`)).toContain(url)
    }
    expect(result.value.attachments.servers).toEqual([...SUPPORT_BLOSSOM_SERVERS])
  })

  it('lets env override agent + bootstrap relays', () => {
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
  })

  it('enables attachment storage from explicit HTTPS Blossom env override', () => {
    const result = readCustomerSupportConfig({
      VITE_ZAPPI_SUPPORT_AGENT_NPUB: agentNpub,
      VITE_ZAPPI_SUPPORT_BOOTSTRAP_RELAYS: 'wss://relay.example',
      VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS:
        'https://blossom-one.example/,http://not-allowed.example,https://blossom-two.example/path/',
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

  it('rejects private-key-like or non-relay env input without falling back to defaults', () => {
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
