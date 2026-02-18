# ZAPPI Wallet

논커스터디얼 Cashu/Lightning 지갑

## 개요

Nostr(NIP-61 NutZap) 및 Cashu 토큰을 관리하고, Lightning Network로 송수금하는 PWA 지갑 앱.

## 주요 기능

- **Lightning 송수금**: Lightning invoice 생성/결제
- **Ecash 관리**: Cashu 토큰 송수금 및 멀티 민트 관리
- **NutZap**: Nostr에서 nutzap(kind:9321) 자동 감지 및 수취
- **백업/복원**: 니모닉 기반 지갑 복원

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

## 상태

개발 중
