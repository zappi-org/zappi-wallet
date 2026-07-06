/**
 * Bootstrap 조각 2 — Nostr Gateway 조립 (bootstrap.ts 순수 이동)
 *
 * kill-switch 스냅샷은 bootstrap.ts가 같은 실행 위치에서 1회 읽어 인자로
 * 전달한다 (설계 §11.1 — 원본은 이 절 안에서 읽었음, 실행 순서 동일).
 */

import { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import { DexieGiftwrapCursorStore } from "@/adapters/storage/dexie/dexie-giftwrap-cursor.store";
import type { KillSwitches } from "@/core/utils/kill-switch";

export function assembleNostrGateway(deps: {
  /** Nostr 개인키 (hex) — unlock 후 사용 가능 */
  nostrPrivateKeyHex: string;
  killSwitches: KillSwitches;
}) {
  const { nostrPrivateKeyHex, killSwitches } = deps;

  // ks.cursor ON이면 store 미주입 → cursor 스펙이 무시되어 구동작(전체 replay)
  const giftwrapCursorStore = killSwitches.cursor
    ? undefined
    : new DexieGiftwrapCursorStore();
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: nostrPrivateKeyHex,
    cursorStore: giftwrapCursorStore,
    // 6단계 (설계 §9/§10): SessionController 위임 — 연결/구독 레지스트리,
    // attach 보장, session lease, per-relay 캐치업. ON이면 레거시 경로 전체.
    useSessionController: !killSwitches["nostr-controller"],
  });

  return { giftwrapCursorStore, nostrGateway };
}
