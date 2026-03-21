import { describe, it, expect } from 'vitest'
import {
  TokenSpentError,
  InsufficientBalanceError,
  MintConnectionError,
  MintError,
  InvalidTokenError,
  InvalidProofError,
  QuoteNotFoundError,
  QuoteExpiredError,
  classifyCashuError,
  RelayConnectionError,
  classifyNostrError,
  NetworkError,
  TimeoutError,
  LightningRoutingError,
  LightningPaymentError,
  InvalidInvoiceError,
  InvoiceExpiredError,
} from '@/core/errors'
import {
  NetworkError as CocoNetworkError,
  MintFetchError,
  MintOperationError,
  ProofOperationError,
  PaymentRequestError,
  HttpResponseError,
  OperationInProgressError,
  UnknownMintError,
  ProofValidationError,
  TokenValidationError,
} from 'coco-cashu-core'

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

  describe('classifyCashuError - Coco SDK typed errors', () => {
    it('should classify CocoNetworkError as MintConnectionError', () => {
      const error = classifyCashuError(new CocoNetworkError('Connection refused'))

      expect(error).toBeInstanceOf(MintConnectionError)
      expect(error.isRetryable).toBe(true)
    })

    it('should classify MintFetchError as MintConnectionError with mintUrl', () => {
      const error = classifyCashuError(new MintFetchError('https://mint.example.com', 'Failed to fetch'))

      expect(error).toBeInstanceOf(MintConnectionError)
      expect((error as MintConnectionError).mintUrl).toBe('https://mint.example.com')
    })

    it('should classify UnknownMintError as MintConnectionError', () => {
      const error = classifyCashuError(new UnknownMintError('Mint not registered'))

      expect(error).toBeInstanceOf(MintConnectionError)
    })

    it('should classify ProofOperationError with "not enough" as InsufficientBalanceError', () => {
      const error = classifyCashuError(new ProofOperationError('https://mint.example.com', 'Not enough funds'))

      expect(error).toBeInstanceOf(InsufficientBalanceError)
    })

    it('should classify ProofOperationError without balance keywords as InvalidProofError', () => {
      const error = classifyCashuError(new ProofOperationError('https://mint.example.com', 'Keyset mismatch'))

      expect(error).toBeInstanceOf(InvalidProofError)
    })

    it('should classify PaymentRequestError as InvalidInvoiceError', () => {
      const error = classifyCashuError(new PaymentRequestError('Invalid bolt11'))

      expect(error).toBeInstanceOf(InvalidInvoiceError)
    })

    it('should classify OperationInProgressError as MintError', () => {
      const error = classifyCashuError(new OperationInProgressError('op-123'))

      expect(error).toBeInstanceOf(MintError)
      expect(error.message).toContain('op-123')
    })

    it('should classify TokenValidationError as InvalidTokenError', () => {
      const error = classifyCashuError(new TokenValidationError('Bad token format'))

      expect(error).toBeInstanceOf(InvalidTokenError)
    })

    it('should classify ProofValidationError as InvalidProofError', () => {
      const error = classifyCashuError(new ProofValidationError('Bad proof'))

      expect(error).toBeInstanceOf(InvalidProofError)
    })

    it('should classify HttpResponseError(500) as MintConnectionError', () => {
      const error = classifyCashuError(new HttpResponseError('Internal Server Error', 500))

      expect(error).toBeInstanceOf(MintConnectionError)
      expect(error.isRetryable).toBe(true)
    })

    it('should classify HttpResponseError(400) as MintError', () => {
      const error = classifyCashuError(new HttpResponseError('Bad Request', 400))

      expect(error).toBeInstanceOf(MintError)
      expect((error as MintError).mintErrorCode).toBe('400')
    })
  })

  describe('classifyCashuError - MintOperationError NUT-00 codes', () => {
    it('should classify code 10002 as TokenSpentError', () => {
      const error = classifyCashuError(new MintOperationError(10002, 'Token already spent'))

      expect(error).toBeInstanceOf(TokenSpentError)
    })

    it('should classify code 10003 as InvalidProofError', () => {
      const error = classifyCashuError(new MintOperationError(10003, 'Invalid proof'))

      expect(error).toBeInstanceOf(InvalidProofError)
    })

    it('should classify code 20001 as QuoteNotFoundError', () => {
      const error = classifyCashuError(new MintOperationError(20001, 'Quote not found'))

      expect(error).toBeInstanceOf(QuoteNotFoundError)
    })

    it('should classify code 20007 as QuoteExpiredError', () => {
      const error = classifyCashuError(new MintOperationError(20007, 'Quote expired'))

      expect(error).toBeInstanceOf(QuoteExpiredError)
    })

    it('should classify routing failure as LightningRoutingError', () => {
      const error = classifyCashuError(new MintOperationError(20006, 'Lightning payment routing failed'))

      expect(error).toBeInstanceOf(LightningRoutingError)
      expect(error.isRetryable).toBe(true)
    })

    it('should classify "no_route" as LightningRoutingError', () => {
      const error = classifyCashuError(new MintOperationError(20006, 'no_route to destination'))

      expect(error).toBeInstanceOf(LightningRoutingError)
    })

    it('should classify payment failure as LightningPaymentError', () => {
      const error = classifyCashuError(new MintOperationError(20006, 'Lightning payment failed'))

      expect(error).toBeInstanceOf(LightningPaymentError)
      expect(error.isRetryable).toBe(false)
    })

    it('should classify invoice expired in detail as InvoiceExpiredError', () => {
      const error = classifyCashuError(new MintOperationError(20006, 'Invoice has expired'))

      expect(error).toBeInstanceOf(InvoiceExpiredError)
    })

    it('should classify unknown code as MintError with code preserved', () => {
      const error = classifyCashuError(new MintOperationError(99999, 'Something unexpected'))

      expect(error).toBeInstanceOf(MintError)
      expect((error as MintError).mintErrorCode).toBe('99999')
    })
  })

  describe('classifyCashuError - string fallback (legacy)', () => {
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

    it('should fall back to MintError for unrecognized errors', () => {
      const error = classifyCashuError('Something completely unknown')

      expect(error).toBeInstanceOf(MintError)
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
