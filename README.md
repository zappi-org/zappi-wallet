# ZAPPI Wallet

A custody-style ecash wallet focused on privacy and usability.

## Features

- **Lightning** — Create & pay invoices via connected mints
- **Ecash** — Send, receive, and swap Cashu tokens across mints
- **Nostr DM** — Send and receive tokens directly via Nostr DMs (gift-wrapped)

## Tech Stack

| Area | Stack |
|------|-------|
| Framework | React 19 + TypeScript + Vite 7 |
| Cashu | @cashu/cashu-ts, @cashu/coco-core, @cashu/coco-indexeddb |
| Nostr | NDK, nostr-tools, nostr-cs |
| Styling | Tailwind CSS 4 + shadcn/ui (Radix primitives) |
| State | Zustand |
| Storage | Dexie.js (IndexedDB) |
| Crypto | @noble/hashes, @noble/curves, @noble/ciphers, @scure/bip39/bip32 |
| PWA | vite-plugin-pwa |
| i18n | i18next with browser language detector |
| Testing | Vitest + Testing Library + MSW |
| Architecture | Hexagonal (ports & adapters) |

## Development

```bash
bun install      # Install dependencies
bun dev          # Start dev server
bun run build    # Type-check & production build
bun test:run     # Run tests
bun run lint     # Lint
```

## Status

Actively developed — open beta
