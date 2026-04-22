// Mock IndexedDB - MUST be first before any other imports
import 'fake-indexeddb/auto'

import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

function createStorageMock(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

const localStorageMock = createStorageMock()
const sessionStorageMock = createStorageMock()

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('sessionStorage', sessionStorageMock)
Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
Object.defineProperty(window, 'sessionStorage', { configurable: true, value: sessionStorageMock })

// Cleanup after each test
afterEach(() => {
  cleanup()
  localStorageMock.clear()
  sessionStorageMock.clear()
})

// Mock window.matchMedia (for PWA detection tests)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
})
