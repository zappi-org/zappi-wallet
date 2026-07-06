/**
 * 민트 URL 동등성 — 도메인 규칙 (감사 Phase 2, 이중 리뷰 층위 판정으로 core/domain 이동)
 *
 * "어떤 표기가 같은 민트인가"는 라우팅(수수료 선택)·복구·잔액 표시가 공유하는
 * 도메인 규칙이며 의존성 0 의 순수 함수다. utils/url.ts 는 하위호환 re-export 를
 * 유지한다 (기존 호출부 무변경).
 *
 * 두 정규화의 역할 분리가 계약이다:
 * - normalizeMintUrl: **저장·와이어 정규화** — 의미 동결. 소문자화·포트 제거 금지
 *   (기존 저장 데이터와의 키 불일치 = 자금 표시 버그).
 * - mintUrlKey: **비교 전용** canonical — 대소문자 호스트·기본 포트(:443/:80)·
 *   trailing slash·프로토콜 생략을 흡수. 반환값을 저장하거나 서버로 보내면 안 된다.
 */

/**
 * Normalize mint URL (cashu.me convention)
 * - Adds https:// if no protocol
 * - Removes trailing slashes
 */
export function normalizeMintUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '')
  if (!/^[a-z]+:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned
  }
  return cleaned
}

/**
 * 민트 URL 비교 전용 canonical key.
 * 경로 대소문자는 보존한다(경로는 대소문자 구분 자원 — coco canonical 과 동일 결정).
 * 파싱 불가 문자열은 normalizeMintUrl 결과를 그대로 키로 쓴다.
 * userinfo·fragment 는 URL 파서 직렬화에서 탈락 — 민트 URL 실사용 0.
 */
export function mintUrlKey(url: string): string {
  const normalized = normalizeMintUrl(url)
  try {
    const u = new URL(normalized)
    const isDefaultPort =
      u.port === '' ||
      (u.protocol === 'https:' && u.port === '443') ||
      (u.protocol === 'http:' && u.port === '80')
    const port = isDefaultPort ? '' : `:${u.port}`
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}${path}${u.search}`
  } catch {
    return normalized
  }
}

/** 두 민트 URL 이 같은 민트를 가리키는지 — 표기 변형(대소문자·:443·슬래시) 흡수 */
export function isSameMintUrl(a: string, b: string): boolean {
  return mintUrlKey(a) === mintUrlKey(b)
}
