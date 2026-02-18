import * as bip39 from '@scure/bip39';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { useAppStore } from '../store';

// 복호화된 니모닉 캐시 (세션 동안 유지)
let cachedMnemonic: string | null = null;

// 캐시된 시드 (privateKey 기반)
let cachedSeed: Uint8Array | null = null;

/**
 * 캐시된 니모닉/시드 초기화 (로그아웃 시 호출)
 */
export function clearCachedMnemonic(): void {
  cachedMnemonic = null;
  cachedSeed = null;
}

/**
 * 니모닉이 캐시되어 있는지 확인
 */
export function isMnemonicCached(): boolean {
  return cachedMnemonic !== null || cachedSeed !== null;
}

/**
 * 니모닉 캐시 설정 (외부에서 니모닉을 직접 설정할 때 사용)
 */
export function setCachedMnemonic(mnemonic: string): void {
  cachedMnemonic = mnemonic;
  cachedSeed = null; // Clear seed cache when mnemonic is set
}

/**
 * privateKey에서 64바이트 시드 파생
 * 현재 앱은 PIN 없이 동작하므로 저장된 privateKey를 사용
 */
function deriveSeedFromPrivateKey(privateKeyHex: string): Uint8Array {
  const privKeyBytes = hexToBytes(privateKeyHex);
  // SHA256을 두 번 적용하여 64바이트 시드 생성
  const hash1 = sha256(privKeyBytes);
  const hash2 = sha256(new Uint8Array([...hash1, ...privKeyBytes]));
  // 64바이트로 확장
  return new Uint8Array([...hash1, ...hash2]);
}

/**
 * Coco Manager용 시드 getter
 * BIP-39 시드 (64바이트) 반환
 */
export async function getSeed(): Promise<Uint8Array> {
  // 1. 캐시된 니모닉이 있으면 BIP-39 시드 반환
  if (cachedMnemonic) {
    return bip39.mnemonicToSeedSync(cachedMnemonic);
  }

  // 2. 캐시된 시드가 있으면 반환
  if (cachedSeed) {
    return cachedSeed;
  }

  // 3. 현재 앱 구조: nostrPrivkey에서 시드 파생 (useAppStore 사용)
  const { nostrPrivkey } = useAppStore.getState();
  if (nostrPrivkey) {
    cachedSeed = deriveSeedFromPrivateKey(nostrPrivkey);
    return cachedSeed;
  }

  // 4. 아무것도 없으면 에러
  throw new Error('No key available for seed generation');
}
