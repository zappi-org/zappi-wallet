export function chatPaymentRequestType(
  content: string
): "cashu" | "invoice" | "uri" | null {
  const value = content.trim();
  if (/^creq/i.test(value)) return "cashu";
  if (/^(lnbc|lntb|lnbcrt|lightning:)/i.test(value)) return "invoice";
  if (/^bitcoin:/i.test(value)) return "uri";
  return null;
}

export interface ChatPaymentNotice {
  type: "zappi-payment";
  version: 1;
  amount: number;
  unit: "sat";
  recipient: string;
  transactionId: string;
  requestMessageId?: string;
  deliveryId?: string;
}

const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value);

export type ChatPaymentLink =
  | {
      kind: "send";
      transactionId: string;
      amount: number;
      requestMessageId?: string;
    }
  | { kind: "request"; requestId: string; amount: number; expiresAt: number };

export function parseChatPaymentLink(value: unknown): ChatPaymentLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const link = value as Record<string, unknown>;
  if (!Number.isSafeInteger(link.amount) || (link.amount as number) <= 0)
    return null;
  if (
    link.kind === "send" &&
    identifier(link.transactionId) &&
    (link.requestMessageId === undefined || identifier(link.requestMessageId))
  ) {
    return {
      kind: "send",
      transactionId: link.transactionId,
      amount: link.amount as number,
      ...(link.requestMessageId === undefined
        ? {}
        : { requestMessageId: link.requestMessageId }),
    };
  }
  if (
    link.kind === "request" &&
    identifier(link.requestId) &&
    Number.isSafeInteger(link.expiresAt) &&
    (link.expiresAt as number) >= 0
  ) {
    return {
      kind: "request",
      requestId: link.requestId,
      amount: link.amount as number,
      expiresAt: link.expiresAt as number,
    };
  }
  return null;
}

/** Notices describe a payment; only local wallet records establish its status. */
export function parseChatPaymentNotice(
  content: string
): ChatPaymentNotice | null {
  if (content.length > 2048 || !content.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const notice = value as Record<string, unknown>;
    if (
      notice.type !== "zappi-payment" ||
      notice.version !== 1 ||
      !Number.isSafeInteger(notice.amount) ||
      (notice.amount as number) <= 0 ||
      notice.unit !== "sat" ||
      typeof notice.recipient !== "string" ||
      !/^[a-f0-9]{64}$/.test(notice.recipient) ||
      !identifier(notice.transactionId) ||
      (notice.deliveryId !== undefined &&
        (typeof notice.deliveryId !== "string" ||
          !/^[a-f0-9]{64}$/.test(notice.deliveryId))) ||
      (notice.requestMessageId !== undefined &&
        !identifier(notice.requestMessageId))
    )
      return null;
    return {
      type: "zappi-payment",
      version: 1,
      amount: notice.amount as number,
      unit: "sat",
      recipient: notice.recipient,
      transactionId: notice.transactionId,
      ...(notice.deliveryId === undefined
        ? {}
        : { deliveryId: notice.deliveryId as string }),
      ...(notice.requestMessageId === undefined
        ? {}
        : { requestMessageId: notice.requestMessageId }),
    };
  } catch {
    return null;
  }
}

export function encodeChatPaymentNotice(
  payment: Omit<ChatPaymentNotice, "type" | "version">
): string {
  const content = JSON.stringify({
    ...payment,
    type: "zappi-payment",
    version: 1,
  });
  const notice = parseChatPaymentNotice(content);
  if (!notice) throw new Error("Invalid chat payment notice");
  return JSON.stringify(notice);
}
