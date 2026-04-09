/**
 * NutZap info — kind:10019 이벤트 파싱 (NIP-61)
 *
 * 순수 함수. NostrEvent tags에서 mint, p2pkPubkey, relay 추출.
 * I/O 없음, 외부 라이브러리 없음.
 */

import type { NostrEvent } from './nostr'

export interface NutZapInfo {
  mints: string[]
  p2pkPubkey?: string
  relays?: string[]
}

export function parseNutZapInfo(event: NostrEvent, unit = 'sat'): NutZapInfo {
  const mints: string[] = []
  let p2pkPubkey: string | undefined
  const relays: string[] = []

  for (const tag of event.tags) {
    if (tag[0] === 'mint' && tag[1] && (tag.length === 2 || tag.slice(2).includes(unit))) {
      mints.push(tag[1])
    } else if (tag[0] === 'pubkey' && tag[1]) {
      p2pkPubkey = tag[1]
    } else if (tag[0] === 'relay' && tag[1]) {
      relays.push(tag[1])
    }
  }

  return { mints, p2pkPubkey, relays: relays.length > 0 ? relays : undefined }
}
