export interface SettingsRepository {
  getSettings(): Promise<WalletSettingsData>
  saveSettings(settings: WalletSettingsData): Promise<void>

  getEncryptedWallet(): Promise<EncryptedWalletData | null>
  saveEncryptedWallet(data: EncryptedWalletData): Promise<void>
  deleteEncryptedWallet(): Promise<void>

  getLockState(): Promise<LockStateData>
  saveLockState(state: LockStateData): Promise<void>

  clearAll(): Promise<void>
}

// 도메인 수준 타입 — core/types의 구체 타입과 1:1이지만 독립 정의
// Phase 3~4에서 기존 타입을 이것으로 전환

export interface WalletSettingsData {
  mints: string[]
  relays: string[]
  autoLockEnabled: boolean
  autoLockTimeoutMinutes: number
  soundEnabled: boolean
  expertModeEnabled: boolean
  manualMintSelectionEnabled: boolean
  balanceHidden: boolean
  [key: string]: unknown  // 추가 설정 허용
}

export interface EncryptedWalletData {
  encryptedMnemonic: string
  salt: string
  iv: string
  [key: string]: unknown
}

export interface LockStateData {
  isLocked: boolean
  failedAttempts: number
}
