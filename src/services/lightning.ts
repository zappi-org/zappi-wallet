import { decode } from 'light-bolt11-decoder';

export interface DecodedInvoice {
  paymentRequest: string;
  amountSats: number;
  expiry: number; // timestamp in seconds
  timestamp: number; // created at timestamp in seconds
  description?: string;
  isExpired: boolean;
  paymentHash?: string;
}

/**
 * Validates if a string is a BOLT11 invoice
 */
export function isBolt11Invoice(pr: string): boolean {
  const invoice = pr.toLowerCase().trim();
  // Basic BOLT11 check: starts with lnbc, lntb, lnptr, etc.
  return invoice.startsWith('lnbc') || 
         invoice.startsWith('lntb') || 
         invoice.startsWith('lnptr') || 
         invoice.startsWith('lncrt');
}

/**
 * Decodes a BOLT11 invoice
 */
export function decodeInvoice(pr: string): DecodedInvoice {
  try {
    const decoded = decode(pr);
    
    const amountSection = decoded.sections.find(s => s.name === 'amount');
    const timestampSection = decoded.sections.find(s => s.name === 'timestamp');
    const expirySection = decoded.sections.find(s => s.name === 'expiry');
    const descriptionSection = decoded.sections.find(s => s.name === 'description');
    const paymentHashSection = decoded.sections.find(s => s.name === 'payment_hash');

    const amountMsat = amountSection && 'value' in amountSection ? Number(amountSection.value) : 0;
    const amountSats = Math.floor(amountMsat / 1000);

    const timestamp = timestampSection && 'value' in timestampSection ? Number(timestampSection.value) : Math.floor(Date.now() / 1000);
    const expiryOffset = expirySection && 'value' in expirySection ? Number(expirySection.value) : 3600; // default 1 hour
    const expiry = timestamp + expiryOffset;

    const isExpired = Math.floor(Date.now() / 1000) > expiry;

    return {
      paymentRequest: pr,
      amountSats,
      expiry,
      timestamp,
      description: descriptionSection && 'value' in descriptionSection ? String(descriptionSection.value) : undefined,
      isExpired,
      paymentHash: paymentHashSection && 'value' in paymentHashSection ? String(paymentHashSection.value) : undefined,
    };
  } catch (error) {
    console.error('Failed to decode invoice:', error);
    throw new Error('올바르지 않은 Lightning 인보이스입니다');
  }
}

/**
 * Validates a Lightning Address format (user@domain.com)
 */
export function isValidLightningAddress(address: string): boolean {
  const regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;
  return regex.test(address);
}
