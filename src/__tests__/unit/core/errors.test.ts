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
  RelayConnectionError,
  classifyNostrError,
  NetworkError,
  TimeoutError,
  LightningRoutingError,
  LightningPaymentError,
  InvalidInvoiceError,
} from '@/core/errors'
import { classifyCashuError } from '@/modules/cashu/internal/classify-error'
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
    })

    it('should detect fee shortage', () => {
      const error = new InsufficientBalanceError(100, 150, undefined, 60)

      expect(error.isFeeShortage).toBe(true)
    })

    it('should detect pure balance shortage', () => {
      const error = new InsufficientBalanceError(1000, 500)

      expect(error.isFeeShortage).toBe(false)
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

  describe('classifyCashuError - MintOperationError codes (cdk-mintd v0.15)', () => {
    // 10xxx: proof verification
    it('should classify code 10001 (TokenNotVerified) as InvalidProofError', () => {
      const error = classifyCashuError(new MintOperationError(10001, 'Token not verified'))

      expect(error).toBeInstanceOf(InvalidProofError)
    })

    // 11xxx: input/output errors
    it('should classify code 11001 (TokenAlreadySpent) as TokenSpentError', () => {
      const error = classifyCashuError(new MintOperationError(11001, 'Token Already Spent'))

      expect(error).toBeInstanceOf(TokenSpentError)
    })

    it('should classify code 11002 (TokenPending) as TokenSpentError', () => {
      const error = classifyCashuError(new MintOperationError(11002, 'Token Pending'))

      expect(error).toBeInstanceOf(TokenSpentError)
    })

    it('should classify code 11005 (TransactionUnbalanced/Insufficient) as InsufficientBalanceError', () => {
      const error = classifyCashuError(new MintOperationError(11005, 'Insufficient funds'))

      expect(error).toBeInstanceOf(InsufficientBalanceError)
    })

    // 20xxx: quote/payment errors
    it('should classify code 20004 (LightningError) as LightningPaymentError', () => {
      const error = classifyCashuError(new MintOperationError(20004, 'Payment failed'))

      expect(error).toBeInstanceOf(LightningPaymentError)
      expect(error.isRetryable).toBe(false)
    })

    it('should classify code 20007 (QuoteExpired) as QuoteExpiredError', () => {
      const error = classifyCashuError(new MintOperationError(20007, 'Expired quote'))

      expect(error).toBeInstanceOf(QuoteExpiredError)
    })

    it('should classify code 20002 (TokensAlreadyIssued) as MintError', () => {
      const error = classifyCashuError(new MintOperationError(20002, 'Quote already issued'))

      expect(error).toBeInstanceOf(MintError)
    })

    // Detail-based fallback
    it('should classify routing failure in detail as LightningRoutingError', () => {
      const error = classifyCashuError(new MintOperationError(20004, 'Lightning routing failed'))

      expect(error).toBeInstanceOf(LightningRoutingError)
      expect(error.isRetryable).toBe(true)
    })

    it('should classify "unknown quote" in detail as QuoteNotFoundError (cdk 50000)', () => {
      const error = classifyCashuError(new MintOperationError(50000, 'Unknown quote'))

      expect(error).toBeInstanceOf(QuoteNotFoundError)
    })

    it('should classify "already spent" in detail as TokenSpentError (non-standard code)', () => {
      const error = classifyCashuError(new MintOperationError(99999, 'Token already spent'))

      expect(error).toBeInstanceOf(TokenSpentError)
    })

    it('should classify "not verified" in detail as InvalidProofError', () => {
      const error = classifyCashuError(new MintOperationError(50000, 'Could not verify DLEQ proof'))

      expect(error).toBeInstanceOf(InvalidProofError)
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
