import type { TranslationKey } from '@/i18n'
import type { TransactionSource } from '@/core/types/wallet'

/**
 * 거래 source → i18n 키 (i18n 리뷰 이월: 미지의 source 값이 동적 키 캐스트를
 * 타고 리터럴 "txDetail.source.xxx" 로 노출되던 구멍의 폴백 헬퍼).
 * 기록측 값 도메인과 로케일 키 집합이 여기서 단일 원천으로 만난다.
 */
const KNOWN_TX_SOURCES = [
  'zappi-pos',
  'zappi-kiosk',
  'zappi-api',
  'zappi-link',
  'wallet',
  'unknown',
] as const satisfies readonly TransactionSource[]

export function txSourceKey(source: string): TranslationKey {
  const known = (KNOWN_TX_SOURCES as readonly string[]).includes(source)
  return `txDetail.source.${known ? source : 'unknown'}` as TranslationKey
}
