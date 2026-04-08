/**
 * profile — 프로필 이벤트 조립/파싱 순수 함수
 *
 * I/O 없음, 외부 의존 없음.
 * 이벤트 발행/조회는 서비스에서 NostrGateway 포트로 위임.
 */

import type { UnsignedNostrEvent, NostrEvent } from './nostr'
// Domain-level constants (inlined for R1 purity — domain imports nothing)
const NOSTR_KINDS = { NUTZAP_INFO: 10019, RELAY_LIST: 10002, DM_RELAY_LIST: 10050 } as const
const CASHU_UNIT = 'sat' as const

// ─── Build (이벤트 조립) ───

export function buildNutZapInfoEvent(
  pubkey: string,
  mints: string[],
  p2pkPubkey?: string,
  relays?: string[],
): UnsignedNostrEvent {
  const tags: string[][] = []

  for (const mint of mints) {
    tags.push(['mint', mint, CASHU_UNIT])
  }

  if (p2pkPubkey) {
    tags.push(['pubkey', p2pkPubkey])
  }

  if (relays) {
    for (const relay of relays) {
      tags.push(['relay', relay])
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: NOSTR_KINDS.NUTZAP_INFO,
    tags,
    content: '',
  }
}

export function buildRelayListEvent(
  pubkey: string,
  relays: string[],
): UnsignedNostrEvent {
  const tags = relays.map((relay) => ['r', relay])

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: NOSTR_KINDS.RELAY_LIST,
    tags,
    content: '',
  }
}

export function buildDMRelayListEvent(
  pubkey: string,
  relays: string[],
): UnsignedNostrEvent {
  const tags = relays.map((relay) => ['relay', relay])

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: NOSTR_KINDS.DM_RELAY_LIST,
    tags,
    content: '',
  }
}

// ─── Parse (이벤트 파싱) ───

export function parseRelayList(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'r' && tag[1])
    .map((tag) => tag[1])
}

export function parseDMRelayList(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'relay' && tag[1])
    .map((tag) => tag[1])
}
