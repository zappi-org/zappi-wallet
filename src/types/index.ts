// 앱 설정
export interface AppConfig {
  mints: string[];
  relays: string[];
  lightningAddress: string;
}

// 결제 상태
export type PaymentStatus = 'pending' | 'paid' | 'expired';

// 결제 요청
export interface PaymentRequest {
  id: string;
  amount: number;
  invoice: string;
  quoteId: string;
  mintUrl: string;
  status: PaymentStatus;
  createdAt: Date;
  expiresAt: Date;
}

// NutZap 이벤트 (kind:9321)
export interface NutZapEvent {
  id: string;
  pubkey: string;
  token: string;
  mintUrl: string;
  amount: number;
  createdAt: number;
}

// Melt 요청
export interface MeltRequest {
  mintUrl: string;
  amount: number;
  lightningAddress: string;
}

// ZAP-02 Message Types (NIP-17 encrypted)
export interface ZapPaymentRequest {
  zap: '02';
  type: 'payment_request';
  content: {
    tx_id: string;
    quote_id: string;
    mint_url: string;
    amount: number;
    unit: string;
    method: 'bolt11';
    expiry?: number;
  };
}

export interface ZapPaymentFulfillment {
  zap: '02';
  type: 'payment_fulfillment';
  content: {
    tx_id: string;
    token: string; // Cashu V4 token (cashuB...)
    status: 'success';
  };
}

export type ZapMessage = ZapPaymentRequest | ZapPaymentFulfillment;
