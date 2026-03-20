import { describe, it, expect } from 'vitest'
import {
  TokenSpentError,
  InsufficientBalanceError,
  MintConnectionError,
  classifyCashuError,
  RelayConnectionError,
  classifyNostrError,
  NetworkError,
  TimeoutError,
} from '@/core/errors'

describe('Cashu Errors', () => {
  describe('TokenSpentError', () => {
    it('should have correct properties', () => {
      const error = new TokenSpentError()

      expect(error.code).toBe('TOKEN_SPENT')
      expect(error.isRetryable).toBe(false)
      expect(error.toUserMessage()).toBe('이미 사용된 토큰입니다')
    })

    it('should accept custom message', () => {
      const error = new TokenSpentError('Custom message')

      expect(error.message).toBe('Custom message')
    })
  })

  describe('InsufficientBalanceError', () => {
    it('should have correct properties', () => {
      const error = new InsufficientBalanceError(1000, 500)

      expect(error.code).toBe('INSUFFICIENT_BALANCE')
      expect(error.isRetryable).toBe(false)
      expect(error.required).toBe(1000)
      expect(error.available).toBe(500)
      expect(error.toUserMessage()).toContain('1,000')
      expect(error.toUserMessage()).toContain('500')
    })
  })

  describe('MintConnectionError', () => {
    it('should have correct properties', () => {
      const error = new MintConnectionError('https://mint.example.com')

      expect(error.code).toBe('MINT_CONNECTION')
      expect(error.isRetryable).toBe(true)
      expect(error.mintUrl).toBe('https://mint.example.com')
    })
  })

  describe('classifyCashuError', () => {
    it('should classify already spent error', () => {
      const error = classifyCashuError('Token already spent')

      expect(error).toBeInstanceOf(TokenSpentError)
    })

    it('should classify insufficient balance error', () => {
      const error = classifyCashuError('Insufficient balance')

      expect(error).toBeInstanceOf(InsufficientBalanceError)
    })

    it('should classify connection error', () => {
      const error = classifyCashuError('Failed to connect to mint')

      expect(error).toBeInstanceOf(MintConnectionError)
    })

    it('should classify "not trusted" error as MintConnectionError', () => {
      const error = classifyCashuError('Mint https://example.com is not trusted')

      expect(error).toBeInstanceOf(MintConnectionError)
    })

    it('should classify "unknown mint" error as MintConnectionError', () => {
      const error = classifyCashuError('Unknown mint error')

      expect(error).toBeInstanceOf(MintConnectionError)
    })
  })
})

describe('Nostr Errors', () => {
  describe('RelayConnectionError', () => {
    it('should have correct properties', () => {
      const error = new RelayConnectionError('wss://relay.example.com')

      expect(error.code).toBe('RELAY_CONNECTION')
      expect(error.isRetryable).toBe(true)
      expect(error.relayUrl).toBe('wss://relay.example.com')
    })
  })

  describe('classifyNostrError', () => {
    it('should classify connection error', () => {
      const error = classifyNostrError('WebSocket connection failed')

      expect(error).toBeInstanceOf(RelayConnectionError)
    })
  })
})

describe('Base Errors', () => {
  describe('NetworkError', () => {
    it('should be retryable', () => {
      const error = new NetworkError('Network failed')

      expect(error.code).toBe('NETWORK_ERROR')
      expect(error.isRetryable).toBe(true)
    })
  })

  describe('TimeoutError', () => {
    it('should be retryable', () => {
      const error = new TimeoutError('Request timed out')

      expect(error.code).toBe('TIMEOUT')
      expect(error.isRetryable).toBe(true)
    })
  })
})
