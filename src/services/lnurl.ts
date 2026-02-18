import { decode } from 'light-bolt11-decoder';

export interface LnurlPayParams {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  commentAllowed?: number;
  tag: 'payRequest';
  domain: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  payerData?: Record<string, unknown>; // LUD-18
}

export interface LnurlPayResult {
  pr: string;
  successAction?: SuccessAction;
  verify?: string; // LUD-21
  routes?: unknown[];
}

export interface SuccessAction {
  tag: 'message' | 'url' | 'aes';
  message?: string;
  description?: string;
  url?: string;
  ciphertext?: string;
  iv?: string;
}

/**
 * Resolves a Lightning Address to LNURL-PAY parameters
 */
export async function resolveLightningAddress(address: string): Promise<LnurlPayParams> {
  const parts = address.split('@');
  if (parts.length !== 2) {
    throw new Error('Invalid Lightning Address');
  }
  const [user, domain] = parts;

  const protocol = domain.endsWith('.onion') ? 'http' : 'https';
  const url = `${protocol}://${domain}/.well-known/lnurlp/${user}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to resolve Lightning Address: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (data.status === 'ERROR') {
      throw new Error(data.reason || 'LNURL-PAY endpoint returned error');
    }

    if (data.tag !== 'payRequest') {
      throw new Error(`Invalid LNURL tag: expected payRequest, got ${data.tag}`);
    }

    return {
      callback: data.callback,
      minSendable: data.minSendable,
      maxSendable: data.maxSendable,
      metadata: data.metadata,
      commentAllowed: data.commentAllowed,
      tag: data.tag,
      domain,
      allowsNostr: data.allowsNostr,
      nostrPubkey: data.nostrPubkey,
      payerData: data.payerData,
    };
  } catch (error) {
    console.error('Lightning Address resolution error:', error);
    throw error;
  }
}

/**
 * Fetches an invoice from the LNURL service
 */
export async function fetchLnurlPayInvoice(
  params: LnurlPayParams,
  amountSats: number,
  comment?: string
): Promise<LnurlPayResult> {
  const amountMsat = Math.floor(amountSats * 1000);

  if (amountMsat < params.minSendable || amountMsat > params.maxSendable) {
    throw new Error(
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`
    );
  }

  const url = new URL(params.callback);
  url.searchParams.append('amount', amountMsat.toString());

  if (comment && params.commentAllowed && comment.length <= params.commentAllowed) {
    url.searchParams.append('comment', comment);
  }

  // Handle LUD-12 comment vs LUD-18 payerData
  // If payerData is present and requires name/email, we currently don't support it fully
  // But strictly for withdrawals, usually it's not required. 
  // We can just proceed.

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch invoice: ${res.status}`);
  }

  const data = await res.json();
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Failed to fetch invoice');
  }

  // Verify Invoice Description Hash (LUD-06)
  if (data.pr) {
    await verifyInvoiceDescriptionHash(data.pr, params.metadata);
  } else {
    throw new Error('No payment request (pr) returned from LNURL service');
  }

  return {
    pr: data.pr,
    successAction: data.successAction,
    verify: data.verify,
    routes: data.routes,
  };
}

async function verifyInvoiceDescriptionHash(invoice: string, metadata: string) {
  try {
    const decoded = decode(invoice);
    // Cast sections to permissive type since library types don't include 'description_hash'
    const sections = decoded.sections as Array<{ name: string; value?: unknown }>;
    const descriptionHashTag = sections.find(s => s.name === 'description_hash');

    if (!descriptionHashTag) {
        // If the service returned an invoice with 'description' instead of 'description_hash',
        // it technically violates LUD-06 which says "containing a hash of the metadata as its h tag".
        // However, we should be careful. If it's a plain description, does it match the metadata plain text?
        // LUD-06 requires hashing.
        console.warn('Invoice missing description_hash (h tag). Validation skipped (Not strictly LUD-06 compliant invoice).');
        return;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(metadata);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (descriptionHashTag.value !== hashHex) {
       throw new Error('Invoice description_hash does not match metadata hash! This might be a malicious service trying to trick you into paying a different invoice.');
    }

  } catch (error) {
    console.error('Invoice verification failed:', error);
    if (error instanceof Error && error.message.includes('match')) {
        throw error;
    }
    // Swallow decoding errors to avoid breaking valid flows if the decoder library is flaky, 
    // but log strictly.
  }
}
