# ZAPPI POS

논커스터디얼 Cashu/Lightning POS 시스템

## 개요

상점 주인이 Nostr(NIP-61 NutZap) 및 Cashu 토큰을 직접 수취하고, Lightning Network로 정산받는 PWA 앱.

## 주요 기능

- **단순 POS 모드**: Lightning invoice 생성 → 결제 → 토큰 수취
- **NutZap 모드**: Nostr에서 nutzap(kind:9321) 자동 감지 및 수취
- **정산**: 보유 토큰을 Lightning Address로 출금 (Melt)
- **백업**: NIP-60 기반 지갑 상태 릴레이 백업

## 특징

- Non-Custodial (비수탁)
- PWA (앱스토어 불필요)
- 멀티 민트 지원

## 기술 스택

| 구분 | 기술 |
|------|------|
| Framework | React + Vite + TypeScript |
| Cashu | @cashu/cashu-ts |
| Nostr | @nostr-dev-kit/ndk |
| UI | Tailwind CSS + shadcn/ui |
| Storage | IndexedDB (Dexie.js) |
| State | Zustand |
| PWA | vite-plugin-pwa |

## 개발

```bash
# 의존성 설치
bun install

# 개발 서버
bun dev

# 빌드
bun run build
```

## 문서

- [기술 명세서](./SPEC.md)

## 관련 프로젝트

- [zappi_api](https://github.com/4xvgal/zappi_api) - NutZap 결제 API 서버

## 상태

개발 중
