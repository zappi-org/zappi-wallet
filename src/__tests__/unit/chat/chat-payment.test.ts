import { describe, expect, it } from "vitest";
import {
  encodeChatPaymentNotice,
  parseChatPaymentNotice,
  parseChatPaymentLink,
  type ChatPaymentNotice,
} from "@/core/domain/chat-payment";

const notice: ChatPaymentNotice = {
  type: "zappi-payment",
  version: 1,
  amount: 1200,
  unit: "sat",
  recipient: "a".repeat(64),
  transactionId: "tx-ecash-send-123",
};
describe("chat payment notices", () => {
  it("validates local links and strips untrusted extra fields", () => {
    expect(
      parseChatPaymentLink({
        kind: "send",
        transactionId: "local-tx",
        amount: 1200,
        status: "settled",
      })
    ).toEqual({ kind: "send", transactionId: "local-tx", amount: 1200 });
    expect(
      parseChatPaymentLink({
        kind: "request",
        requestId: "request-1",
        amount: 1200,
        expiresAt: 1234,
      })
    ).toEqual({
      kind: "request",
      requestId: "request-1",
      amount: 1200,
      expiresAt: 1234,
    });
    expect(
      parseChatPaymentLink({
        kind: "send",
        transactionId: "local-tx",
        amount: 0,
      })
    ).toBeNull();
    expect(
      parseChatPaymentLink({
        kind: "request",
        requestId: "request-1",
        amount: 1200,
        expiresAt: -1,
      })
    ).toBeNull();
    expect(
      parseChatPaymentLink({
        kind: "request",
        requestId: "request-1",
        amount: 1200,
        expiresAt: Infinity,
      })
    ).toBeNull();
    expect(parseChatPaymentLink({ kind: "other", amount: 1200 })).toBeNull();
  });
  it("round trips a bounded notice without serializing extra payment secrets", () => {
    const encoded = encodeChatPaymentNotice({
      ...notice,
      token: "secret",
      status: "settled",
    } as typeof notice);
    expect(parseChatPaymentNotice(encoded)).toEqual(notice);
    expect(encoded).not.toContain("secret");
    expect(encoded).not.toContain("settled");
  });

  it("preserves the bounded delivery reference", () => {
    const delivery = { ...notice, deliveryId: "c".repeat(64) };
    expect(parseChatPaymentNotice(encodeChatPaymentNotice(delivery))).toEqual(
      delivery
    );
  });

  it("rejects malformed, unsupported and non-integer payment claims", () => {
    for (const patch of [
      { amount: -1 },
      { amount: 0 },
      { amount: 1.5 },
      { amount: Number.MAX_SAFE_INTEGER + 1 },
      { amount: "1200" },
      { unit: "usd" },
      { version: 2 },
      { recipient: "invalid" },
      { transactionId: "<script>" },
      { deliveryId: "wrong" },
      { deliveryId: 123 },
      { deliveryId: "a".repeat(65) },
      { requestMessageId: "x".repeat(161) },
    ])
      expect(
        parseChatPaymentNotice(JSON.stringify({ ...notice, ...patch }))
      ).toBeNull();
    expect(parseChatPaymentNotice("creqAvalidRequest")).toBeNull();
    expect(parseChatPaymentNotice("{broken")).toBeNull();
    expect(parseChatPaymentNotice(" ".repeat(2049))).toBeNull();
  });
});
