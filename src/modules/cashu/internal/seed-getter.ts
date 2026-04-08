import * as bip39 from '@scure/bip39';

// 복호화된 니모닉 캐시 (세션 동안 유지)
let cachedMnemonic: string | null = null;

/**
 * 캐시된 니모닉 초기화 (로그아웃 시 호출)
 */
export function clearCachedMnemonic(): void {
  cachedMnemonic = null;
}

/**
 * 니모닉이 캐시되어 있는지 확인
 */
export function isMnemonicCached(): boolean {
  return cachedMnemonic !== null;
}

/**
 * 니모닉 캐시 설정 (외부에서 니모닉을 직접 설정할 때 사용)
 */
export function setCachedMnemonic(mnemonic: string): void {
  cachedMnemonic = mnemonic;
}

/**
 * Coco Manager용 시드 getter
 * BIP-39 표준 시드 (64바이트) 반환
 */
export async function getSeed(): Promise<Uint8Array> {
  if (cachedMnemonic) {
    return bip39.mnemonicToSeedSync(cachedMnemonic);
  }

  throw new Error('Seed not available: wallet must be unlocked first');
}
