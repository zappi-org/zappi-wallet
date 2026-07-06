import { useCallback } from 'react'
import type { SecurityUseCase } from '@/core/ports/driving/security.usecase'
import { useAppStore } from '@/store'

export interface UseSecurityHandlersDeps {
  /** preUnlock.security — unlock 전에도 존재하는 보안 서비스 (composition 경유 생성, MainApp 주입) */
  security: SecurityUseCase
  /**
   * 계정 데이터 완전 소거 배선 (composition/logout.wipeAccountData).
   * 훅이 composition을 직접 import하지 않도록(ui/hooks는 core 포트만 의존)
   * registry·removePasskey까지 바인딩된 클로저를 MainApp이 주입한다.
   */
  wipeAccount: () => Promise<void>
}

export interface SecurityHandlers {
  handleAutoLock: () => void
  /**
   * false = 현재 PIN 불일치 전용(INVALID_PASSWORD). 스토리지/암호화 인프라
   * 실패(CHANGE_PASSWORD_FAILED, NO_WALLET)는 throw — 호출부 catch 가
   * lock.errorOccurred 로 표면화한다 (R2-B 4번: 인프라 실패의 wrongPin 오표시 수정).
   */
  handleChangePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  /** false = PIN 불일치 전용. VERIFY_FAILED/NO_WALLET(인프라 실패)은 throw. */
  handleVerifyPin: (pin: string) => Promise<boolean>
  /** null = PIN 불일치 전용. GET_MNEMONIC_FAILED/NO_WALLET(인프라 실패)은 throw. */
  handleBackupMnemonic: (password: string) => Promise<string | null>
  /**
   * false = PIN 불일치 전용. VERIFY_FAILED(인프라 실패)·소거 실패는 throw.
   * NO_WALLET 은 반쪽-소거 구제 경로로 소거를 재개한다 (Phase 1 이중 리뷰 처방 유지).
   */
  handleLogout: (password: string) => Promise<boolean>
}

/**
 * 보안 핸들러 묶음 (MainApp Phase 4b 순수 이동): 자동잠금 발화, PIN 변경/검증,
 * 니모닉 백업, 로그아웃(=완전 소거).
 *
 * handleUnlock은 부트스트랩 심(createBootstrap 호출 + 레지스트리 세대 교체)이라
 * MainApp 잔류 — serviceRegistry 상태 소유권과 composition 배선은 MainApp 소관.
 */
export function useSecurityHandlers(deps: UseSecurityHandlersDeps): SecurityHandlers {
  const { security, wipeAccount } = deps
  const setLocked = useAppStore((state) => state.setLocked)

  // 자동잠금 (감사 §6 실구현, 전자 정책): 유휴 시간 초과 시 UI 잠금 + 메모리
  // 비밀(키·시드·니모닉 캐시) 소거. 레지스트리는 유지 — PWA는 OS 푸시가 없어
  // "앱이 살아있는 동안의 수신"이 전부이고, 세션을 죽이면 해제마다 재연결
  // 버스트가 부활한다. 화면 복귀 시 즉시 재판정(freeze 중 타이머 정지 보완).
  const handleAutoLock = useCallback(() => {
    security.lock()
    setLocked(true)
  }, [security, setLocked])

  const handleChangePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<boolean> => {
    const result = await security.changePassword(oldPassword, newPassword)
    // 인프라 실패(스토리지/암복호화)를 false 로 뭉개면 "현재 PIN 오류"로 오표시된다 —
    // INVALID_PASSWORD 만 false, 나머지는 throw → 호출부가 lock.errorOccurred 표시
    if (!result.ok && result.error.code !== 'INVALID_PASSWORD') throw result.error
    return result.ok
  }, [security])

  const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const result = await security.verifyPassword(pin)
    // Err(VERIFY_FAILED/NO_WALLET) = 인프라 실패 — "PIN 불일치"(Ok(false))와 다르다.
    // throw 하여 wrongPin 오표시 대신 lock.errorOccurred 계열로 분기 (R2-B 4번)
    if (!result.ok) throw result.error
    return result.value
  }, [security])

  const handleBackupMnemonic = useCallback(async (password: string): Promise<string | null> => {
    const result = await security.getMnemonic(password)
    if (result.ok) {
      return result.value
    }
    if (result.error.code === 'INVALID_PASSWORD') {
      return null // PIN 불일치 — 호출부가 wrongPin 표시
    }
    throw result.error // 인프라 실패 — 호출부 catch 가 lock.errorOccurred 표시
  }, [security])

  const handleLogout = useCallback(async (password: string): Promise<boolean> => {
    const result = await security.verifyPassword(password)
    // NO_WALLET = 과거 소거가 지갑 레코드 삭제 후 중단된 반쪽 상태(구버전 순서의
    // 유산) — 검증할 비밀이 없는데 잔존 데이터는 있다. wrongPin 으로 오도하는 대신
    // 소거를 재개시켜 탈출구를 준다 (Phase 1 이중 리뷰 처방 — 시맨틱 유지).
    const isHalfWipedState = !result.ok && result.error.code === 'NO_WALLET'
    // VERIFY_FAILED 등 인프라 실패는 "PIN 오류"가 아니다 — throw 하여
    // SettingsScreen catch 가 lock.errorOccurred 로 표면화한다 (R2-B 4번)
    if (!result.ok && !isHalfWipedState) throw result.error
    if (!isHalfWipedState && !(result.ok && result.value)) {
      return false // PIN 불일치 — SettingsScreen 이 wrongPin 표시
    }
    // 소거 실패는 throw 그대로 전파 — SettingsScreen 이 lock.errorOccurred 로
    // 표면화한다 (감사 Phase 1: 성공 가장 금지). 조각별 삭제는 wipeAccountData 로
    // 대체 — registry 부재 시에도 coco DB 를 포함해 전부 소거된다.
    await wipeAccount()
    window.location.reload()
    return true
  }, [security, wipeAccount])

  return {
    handleAutoLock,
    handleChangePassword,
    handleVerifyPin,
    handleBackupMnemonic,
    handleLogout,
  }
}
