import { Mint, Wallet, MintQuoteState, getEncodedToken } from '@cashu/cashu-ts';
import { resolveLightningAddress, fetchLnurlPayInvoice, type LnurlPayParams } from './lnurl';
import { decodeInvoice, isBolt11Invoice, type DecodedInvoice } from './lightning';
import {
  createMintQuote as cocoCreateMintQuote,
  redeemMintQuote as cocoRedeemMintQuote,
  isCocoInitialized,
  getCocoManager,
} from '@/coco';

export {
  resolveLightningAddress,
  fetchLnurlPayInvoice,
  type LnurlPayParams,
  decodeInvoice,
  isBolt11Invoice,
  type DecodedInvoice
};

interface MintQuoteResult {
  quoteId: string;
  invoice: string;
  expiresAt: number;
}

interface QuoteStatus {
  paid: boolean;
  state: string;
}

const walletCache = new Map<string, Wallet>();

async function getWallet(mintUrl: string): Promise<Wallet> {
  if (!walletCache.has(mintUrl)) {
    const mint = new Mint(mintUrl);
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    walletCache.set(mintUrl, wallet);
  }
  return walletCache.get(mintUrl)!;
}

export async function createMintQuote(
  mintUrl: string,
  amount: number
): Promise<MintQuoteResult> {
  // Coco 사용 가능 시 Coco로 처리
  if (isCocoInitialized()) {
    const result = await cocoCreateMintQuote(mintUrl, amount);
    return {
      quoteId: result.quote,
      invoice: result.request,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // Fallback to cashu-ts
  const wallet = await getWallet(mintUrl);
  const quote = await wallet.createMintQuote(amount);

  return {
    quoteId: quote.quote,
    invoice: quote.request,
    expiresAt: quote.expiry || Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function checkMintQuote(
  mintUrl: string,
  quoteId: string
): Promise<QuoteStatus> {
  const wallet = await getWallet(mintUrl);
  const quote = await wallet.checkMintQuote(quoteId);

  // Check both enum and string comparison for compatibility
  const isPaid =
    String(quote.state) === String(MintQuoteState.PAID) ||
    String(quote.state) === 'PAID' ||
    (quote as { paid?: boolean }).paid === true;

  return {
    paid: isPaid,
    state: String(quote.state),
  };
}

export async function mintTokens(
  mintUrl: string,
  amount: number,
  quoteId: string
): Promise<{ proofs: unknown[] }> {
  // Coco 사용 가능 시 Coco로 처리 (proofs는 자동 저장됨)
  if (isCocoInitialized()) {
    await cocoRedeemMintQuote(mintUrl, quoteId, amount);
    // Coco는 내부적으로 proofs를 저장하므로 빈 배열 반환
    // (기존 코드가 proofs를 사용하지 않는 경우에만 호환)
    return { proofs: [] };
  }

  // Fallback to cashu-ts
  const wallet = await getWallet(mintUrl);
  const proofs = await wallet.mintProofs(amount, quoteId);

  return { proofs };
}

export async function getMintInfo(mintUrl: string): Promise<unknown> {
  // Coco 사용 가능 시 Coco로 처리
  if (isCocoInitialized()) {
    const manager = await getCocoManager();
    return await manager.mint.getMintInfo(mintUrl);
  }

  // Fallback to cashu-ts
  const mint = new Mint(mintUrl);
  return await mint.getInfo();
}

export async function meltTokens(
  mintUrl: string,
  invoice: string,
  proofs: Array<{ C: string; amount: number; secret: string; id: string }>
): Promise<{ paid: boolean; preimage?: string; change?: unknown[] }> {
  const wallet = await getWallet(mintUrl);

  try {
    // Create melt quote to get fee estimate
    const quote = await wallet.createMeltQuote(invoice);

    const totalProofAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    const requiredAmount = quote.amount + quote.fee_reserve;

    if (totalProofAmount < requiredAmount) {
      throw new Error(
        `잔액 부족: ${totalProofAmount} sat 있음, ${requiredAmount} sat 필요 (수수료 포함)`
      );
    }

    // Perform melt
    const result = await wallet.meltProofs(quote, proofs);

    return {
      paid: result.quote.state === 'PAID',
      preimage: result.quote.payment_preimage ?? undefined,
      change: result.change,
    };
  } catch (err) {
    // Extract meaningful error message
    if (err instanceof Error) {
      const message = err.message || '출금 실패';
      // Check for common error patterns
      if (message.includes('insufficient')) {
        throw new Error('잔액이 부족합니다 (수수료 포함)');
      }
      throw new Error(message);
    }
    throw new Error('출금 중 오류가 발생했습니다');
  }
}

// Fetch invoice from Lightning Address using LNURL-Pay
export async function fetchInvoiceFromLnAddress(
  lnAddress: string,
  amountSats: number
): Promise<string> {
  const params = await resolveLightningAddress(lnAddress);
  const result = await fetchLnurlPayInvoice(params, amountSats);
  return result.pr;
}

export function clearWalletCache(): void {
  walletCache.clear();
}

// Get melt fee info from mint
export async function getMeltFeeInfo(mintUrl: string): Promise<{
  feePercent: number; // fee in ppm (parts per million), e.g., 1000 = 0.1%
  feeBase: number; // base fee in sats
}> {
  try {
    const mint = new Mint(mintUrl);
    const info = await mint.getInfo();

    // NUT-05 melt fee info is in nuts["5"]
    const nut5 = (info as { nuts?: { '5'?: { methods?: Array<{ ppp?: number; method?: string }> } } }).nuts?.['5'];

    if (nut5?.methods && nut5.methods.length > 0) {
      // ppp = parts per thousand (not million) in some implementations
      const method = nut5.methods[0];
      return {
        feePercent: method.ppp || 0,
        feeBase: 0,
      };
    }

    // Default fallback: 1% fee
    return { feePercent: 10000, feeBase: 0 }; // 10000 ppm = 1%
  } catch {
    // Fallback
    return { feePercent: 10000, feeBase: 0 };
  }
}

// Calculate melt fee based on mint info
export function calculateMeltFee(amount: number, feePercent: number, feeBase: number): number {
  const percentFee = Math.ceil((amount * feePercent) / 1000000); // ppm to actual fee
  return percentFee + feeBase;
}

// Estimate fee conservatively (used before we can query the mint)
export function estimateMeltFee(amount: number): number {
  // Conservative: 1% or 2 sats minimum
  const percentFee = Math.ceil(amount * 0.01);
  return Math.max(percentFee, 2);
}

// Get actual fee from melt quote (most accurate)
export async function getMeltQuoteFee(
  mintUrl: string,
  invoice: string
): Promise<{ fee: number; amount: number }> {
  const wallet = await getWallet(mintUrl);
  const quote = await wallet.createMeltQuote(invoice);
  return {
    fee: quote.fee_reserve,
    amount: quote.amount,
  };
}

export function sumProofs(proofs: Array<{ amount: number }>): number {
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}

export function generateToken(
  mintUrl: string,
  proofs: Array<{ C: string; amount: number; secret: string; id: string }>
): string {
  return getEncodedToken({
    mint: mintUrl,
    proofs: proofs,
  });
}

export async function checkProofsSpent(
  mintUrl: string,
  proofs: Array<{ secret: string }>
): Promise<string[]> {
  const wallet = await getWallet(mintUrl);
  // checkProofsStates returns array of ProofState objects
  const states = await wallet.checkProofsStates(proofs);

  // Return the secrets of the spent proofs (matching by index is safer if order is preserved,
  // but checkProofsStates implementation suggests it returns in order)
  // However, checkProofsStates maps Ys to states. Let's rely on the returned index.
  const spentSecrets: string[] = [];
  states.forEach((state, index) => {
      if (String(state.state) === 'SPENT') {
          spentSecrets.push(proofs[index].secret);
      }
  });

  return spentSecrets;
}

/**
 * Subscribe to proof state updates via WebSocket (NUT-17)
 * Returns a canceller function, or null if WebSocket is not supported (caller should fall back to polling)
 */
export async function subscribeProofSpent(
  mintUrl: string,
  proofs: Array<{ C: string; amount: number; secret: string; id: string }>,
  onSpent: () => void,
  onError?: (error: Error) => void
): Promise<(() => void) | null> {
  try {
    const wallet = await getWallet(mintUrl);

    // Check if mint supports WebSocket (NUT-17)
    const mintInfo = await wallet.mint.getInfo();
    const nut17 = (mintInfo as { nuts?: Record<string, unknown> }).nuts?.['17'];
    if (!nut17) {
      console.log('[WebSocket] Mint does not support NUT-17 WebSocket');
      return null;
    }

    // Ensure WebSocket is connected
    if (!wallet.mint.webSocketConnection) {
      await wallet.mint.connectWebSocket();
    }

    // Subscribe to proof state updates
    const canceller = await wallet.on.proofStateUpdates(
      proofs,
      (payload) => {
        console.log('[WebSocket] Proof state update:', payload.state);
        if (String(payload.state) === 'SPENT') {
          onSpent();
        }
      },
      (error: Error) => {
        console.error('[WebSocket] Proof state subscription error:', error);
        // Clean up the subscription on error
        canceller();
        // Notify caller so it can fall back to polling
        onError?.(error);
      }
    );

    return canceller;
  } catch (error) {
    console.warn('[WebSocket] Failed to subscribe to proof state updates:', error);
    return null;
  }
}
