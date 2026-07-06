/**
 * 로그아웃 = 계정 데이터 완전 소거 (감사 Phase 1)
 *
 * 구버전 로그아웃은 조각별 삭제(설정·거래·연락처…)라 나열 드리프트에 취약했고,
 * registry 가 없으면 자금 DB(coco)가 통째로 살아남았으며, 실패는 무음으로
 * 성공을 가장했다. 이 모듈이 소거 정책의 단일 지점이다.
 *
 * 순서가 계약이다 — 핵심 불변식: **니모닉(지갑 레코드)은 마지막 가멸 단계다.**
 * 앞 단계(②③)가 어디서 실패해도 지갑 레코드가 남아 있으므로 verifyPassword 가
 * 정상 동작해 사용자는 로그아웃을 의미 있게 재시도할 수 있고(모든 단계 멱등 —
 * 없는 DB 삭제는 즉시 성공), 앱은 잠금 화면에 머물러 온보딩-상속이 불가능하다.
 * 역순(니모닉 먼저)은 실패 시 "니모닉 소멸 + 평문 bearer proofs 잔존 + 재시도
 * 불가(NO_WALLET→wrongPin 오표시) + 다음 온보딩 계정이 이전 자금·내역 상속"이라는
 * 최악의 반쪽 상태를 만든다 (Phase 1 이중 리뷰 BLOCKING 판정).
 *
 * ⓪ 타 탭 reload 신호(선행) — 소거 동안 타 탭의 진행 중 쓰기가 데이터를 부활시키는
 *    창을 닫는다. reload 된 탭은 잠금/온보딩 화면이라 coco 를 열지 않는다(coco 초기화는
 *    unlock 후). 소거 완료 후 ⑥에서 한 번 더 쏴 소거 중 새로 열린 탭까지 잡는다.
 * ① 이 탭의 쓰기 주체 정지 — support.destroy() + registry.dispose() (타이머·소켓·
 *    watcher 가 소거 중/후에 DB 를 되살리는 것을 방지). registry 부재(부트스트랩 전)
 *    여도 데이터 소거는 진행한다.
 * ② 자금 DB(coco) 삭제 — 대기형+타임아웃 (deleteCocoData 재작성, blocked 무음 성공 금지).
 * ③ zappi DB 소거 — clear-first, delete-best-effort. ㉠ 살아있는 커넥션에서 전 테이블
 *    clear (버전 변경 불요 — 타 탭이 열려 있어도 블록 불가, 동적 열거로 나열-드리프트
 *    차단) → ㉡ db.delete() 는 타임아웃부 best-effort (blocked 여도 데이터는 이미 소거).
 *    역순 불가: Dexie delete() 는 자기 커넥션을 먼저 닫아 타임아웃 시점엔 폴백이
 *    커넥션을 얻지 못한다.
 * ④ 암호화 지갑(니모닉, zappi-secure) 삭제 — 데이터가 전부 사라진 뒤에만.
 * ⑤ localStorage 정책 —
 *    삭제: passkey 자격증명+암호화 PIN(레거시 포함, removePasskey 주입),
 *          zappi-anchor(남기면 다른 니모닉 재온보딩이 full replay 를 생략해 자금 미발견),
 *          zappi-balance-cache(이전 계정 잔액 잔상), zappi_last_alive_at.
 *    유지: lockout·zappi_invite_*(브루트포스 방어는 계정 무관 기기 방어),
 *          zappi-language(기기 선호), zappi.ks.*(기기 킬스위치).
 * ⑥ broadcastSync('logout') 재송신 → ⑦ 스토어 리셋. 페이지 reload 는 호출자(MainApp) 책임.
 *
 * 데이터-소거 단계(②③㉠④)의 실패는 throw 로 표면화한다 — 성공 가장 금지.
 * SettingsScreen 은 throw 를 lock.errorOccurred 로 표시한다 (false 는 PIN 오류 전용).
 */

import { getDatabase } from '@/adapters/storage/dexie/schema'
import { AnchorStoreAdapter } from '@/adapters/storage/anchor-store.adapter'
import { LocalStorageBalanceCache } from '@/adapters/cache/local-storage-balance-cache.adapter'
import { deleteCocoData } from '@/modules/cashu'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useAppStore } from '@/store'
import { STORAGE_KEYS } from '@/core/constants'

const ZAPPI_DB_DELETE_TIMEOUT_MS = 5_000

export interface WipeAccountDeps {
  /** zappi-secure 의 암호화 지갑 레코드 삭제 */
  security: { deleteWallet(): Promise<void> }
  /** null = 부트스트랩 전/잠금 상태 — 정지할 쓰기 주체가 없다는 뜻일 뿐, 소거는 동일 */
  registry: { support: { destroy(): Promise<void> }; dispose(): void } | null
  /** passkey 자격증명+암호화 PIN 제거 (레거시 키 포함) — ui/services/passkey 를
   *  composition 이 직접 import 하지 않도록 호출자가 주입 */
  removePasskey: () => void
}

export async function wipeAccountData(deps: WipeAccountDeps): Promise<void> {
  // ⓪ 타 탭 정지(reload) 신호 — 소거 창 동안의 타 탭 부활 쓰기 차단.
  // 잔여 창(수용): reload 된 잠금 탭에서 사용자가 소거 창(~수 초) 안에 PIN 을
  // 완주하면 빈 coco DB 가 재생성될 수 있으나, ⑥ 재송신이 그 탭을 다시 reload 한다.
  broadcastSync('logout')

  // ① 이 탭의 쓰기 주체 정지 — 실패해도 소거는 계속한다 (중단이 더 많은 데이터를 남긴다)
  if (deps.registry) {
    await deps.registry.support.destroy().catch((e) => {
      console.warn('[Logout] support.destroy failed — continuing wipe:', e)
    })
    try {
      deps.registry.dispose()
    } catch (e) {
      console.warn('[Logout] registry.dispose failed — continuing wipe:', e)
    }
  }

  // ② 자금 DB (coco) — 실패 시 throw. 지갑 레코드가 아직 있으므로 재시도 가능 상태다
  await deleteCocoData()

  // ③ zappi DB — clear-first, delete-best-effort
  const db = getDatabase()
  await Promise.all(db.tables.map((table) => table.clear()))
  try {
    await withTimeout(db.delete(), ZAPPI_DB_DELETE_TIMEOUT_MS, 'zappi DB delete')
  } catch (e) {
    // 데이터는 ㉠에서 이미 소거됨 — 스키마 껍데기만 남는 열화를 기록하고 진행
    console.warn('[Logout] zappi DB delete blocked/failed after clear (data already wiped):', e)
  }

  // ④ 암호화 지갑(니모닉) — 마지막 가멸 단계. 여기 도달 = 계정 데이터는 이미 전무
  await deps.security.deleteWallet()

  // ⑤ localStorage 정책
  deps.removePasskey()
  new AnchorStoreAdapter().clearCachedAnchor()
  new LocalStorageBalanceCache().clear()
  localStorage.removeItem(STORAGE_KEYS.LAST_ALIVE)

  // ⑥ 소거 중 새로 열렸을 수 있는 탭까지 reload
  broadcastSync('logout')

  // ⑦ 스토어 리셋 — reload 전 잔상 방지
  useAppStore.getState().resetAll()
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
