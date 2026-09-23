import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/core/domain/chat";
import { encodeChatPaymentNotice } from "@/core/domain/chat-payment";
import { useChatPaymentRecords } from "@/ui/hooks/use-chat-payment-records";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  decodeCashuRequest: vi.fn(),
  findProcessed: vi.fn(),
  findByRequestId: vi.fn(),
}));
const registry = {
  inputParser: { decodeCashuRequest: mocks.decodeCashuRequest },
  transactionMgmt: { getById: mocks.getById },
  processedStore: { findById: mocks.findProcessed },
  receiveRequest: { findByRequestId: mocks.findByRequestId },
};
vi.mock("@/ui/hooks/use-service-registry", () => ({
  useServiceRegistry: () => registry,
}));

const notice = {
  amount: 1200,
  unit: "sat" as const,
  recipient: "b".repeat(64),
  transactionId: "tx-1",
  requestMessageId: "request-message",
};
const message: ChatMessage = {
  id: "notice-1",
  conversationId: "conversation",
  sender: "a".repeat(64),
  recipient: notice.recipient,
  content: encodeChatPaymentNotice(notice),
  createdAt: 1,
  outgoing: true,
  status: "sent",
  payment: {
    kind: "send",
    transactionId: "tx-1",
    amount: 1200,
    requestMessageId: "request-message",
  },
};
const request: ChatMessage = {
  ...message,
  id: "request-message",
  sender: message.recipient,
  recipient: message.sender,
  outgoing: false,
  content: "CREQBrequest",
  payment: undefined,
};
const transaction = {
  id: "tx-1",
  direction: "send",
  amount: { value: 1200n, unit: "sat" },
  status: "pending",
  outcome: "unclaimed",
};

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  mocks.getById.mockResolvedValue(transaction);
  mocks.decodeCashuRequest.mockReturnValue({ id: "cashu-request", amount: 1200, unit: "sat" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useChatPaymentRecords", () => {
  it("never fetches an incoming or unlinked wire transaction ID", async () => {
    const { result } = renderHook(() =>
      useChatPaymentRecords(
        [
          { ...message, outgoing: false },
          { ...message, id: "unlinked", payment: undefined },
        ],
        true
      )
    );
    await act(async () => {});
    expect(result.current.size).toBe(0);
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("uses the linked transaction and maps pending payment to the original request", async () => {
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unclaimed")
    );
    expect(result.current.get("request-message")?.transaction).toEqual(
      transaction
    );
    expect(mocks.getById).toHaveBeenCalledWith("tx-1");
  });

  it("uses a persisted receive payment reference and guards its expiry", async () => {
    mocks.findByRequestId.mockResolvedValue({
      amount: 1200,
      fulfillmentStatus: "pending",
    });
    const request: ChatMessage = {
      ...message,
      id: "request",
      content: "creqA...",
      payment: {
        kind: "request",
        requestId: "ecash-ref",
        amount: 1200,
        expiresAt: Date.now() - 1,
      },
    };
    const { result } = renderHook(() => useChatPaymentRecords([request], true));
    await waitFor(() =>
      expect(result.current.get("request")?.status).toBe("expired")
    );
    expect(mocks.findByRequestId).toHaveBeenCalledWith("ecash-ref");
    mocks.findByRequestId.mockResolvedValue({
      amount: 1200,
      fulfillmentStatus: "fulfilled",
    });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() =>
      expect(result.current.get("request")?.status).toBe("settled")
    );
  });

  it("reports unknown when a lookup fails or the local amount mismatches", async () => {
    mocks.getById.mockRejectedValue(new Error("storage"));
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unknown")
    );
    expect(result.current.get("request-message")?.status).toBe("unknown");
    mocks.getById.mockResolvedValue({
      ...transaction,
      amount: { value: 1201n, unit: "sat" },
    });
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {});
    expect(result.current.get(message.id)?.status).toBe("unknown");
  });

  it("rejects a notice changed to point at a different transaction before lookup", async () => {
    const forged = {
      ...message,
      content: encodeChatPaymentNotice({ ...notice, transactionId: "other" }),
    };
    const { result } = renderHook(() => useChatPaymentRecords([forged], true));
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unknown")
    );
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", "unclaimed", "unclaimed"],
    ["pending", undefined, "pending"],
    ["settled", "claimed", "settled"],
    ["settled", "reclaimed", "cancelled"],
    ["failed", "unclaimed", "failed"],
  ])("uses local %s/%s state as %s", async (status, outcome, expected) => {
    mocks.getById.mockResolvedValue({ ...transaction, status, outcome });
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe(expected)
    );
    expect(result.current.get("request-message")?.status).toBe(expected);
  });

  it.each([
    { id: "other-transaction" },
    { direction: "receive" },
    { amount: { value: 1200n, unit: "msat" } },
  ])("rejects a mismatched local transaction %#", async (patch) => {
    mocks.getById.mockResolvedValue({ ...transaction, ...patch });
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unknown")
    );
    expect(result.current.get(message.id)?.transaction).toBeUndefined();
  });

  it("does not publish a stale lookup after lock and does not poll a covered room", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.getById.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { result, rerender } = renderHook(
      ({ active }) => useChatPaymentRecords([message], active),
      { initialProps: { active: true } }
    );
    rerender({ active: false });
    await act(async () => {
      resolve(transaction);
      await Promise.resolve();
    });
    expect(result.current.size).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mocks.getById).toHaveBeenCalledTimes(1);
  });

  it("does not query while the document is hidden and refreshes on return", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    renderHook(() => useChatPaymentRecords([request, message], true));
    expect(mocks.getById).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(1));
  });
});

describe("incoming payment receipts", () => {
  const deliveryId = "c".repeat(64);
  const incoming = {
    ...message,
    outgoing: false,
    payment: undefined,
    content: encodeChatPaymentNotice({ ...notice, deliveryId }),
  };
  const receipt = {
    ...transaction,
    id: deliveryId,
    direction: "receive",
    status: "settled",
    fee: {
      quoted: { value: 0n, unit: "sat" },
      effective: { value: 2n, unit: "sat" },
    },
    metadata: {
      paymentDelivery: {
        id: deliveryId,
        sender: message.sender,
        recipient: message.recipient,
        amount: 1200,
        requestId: "cashu-request",
      },
    },
  };
  it("resolves the exact verified incoming delivery including receive fees", async () => {
    mocks.getById.mockResolvedValue(receipt);
    const { result } = renderHook(() =>
      useChatPaymentRecords([incoming], true)
    );
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("settled")
    );
    expect(mocks.getById).toHaveBeenCalledWith(deliveryId);
    expect(result.current.get("request-message")).toBeUndefined();
    expect(result.current.get(message.id)?.transaction).toEqual(receipt);
  });
  it("attaches only a verified receipt to the original outgoing request", async () => {
    mocks.getById.mockResolvedValue(receipt);
    const original = { ...request, outgoing: true };
    const { result } = renderHook(() => useChatPaymentRecords([original, incoming], true));
    await waitFor(() => expect(result.current.get(original.id)?.transaction).toEqual(receipt));
    expect(result.current.get(incoming.id)?.transaction).toEqual(receipt);
    expect(result.current.get(incoming.id)).not.toHaveProperty("foldedIntoRequestId");
    mocks.getById.mockResolvedValue({ ...receipt, metadata: undefined });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.get(incoming.id)?.status).toBe("unknown"));
    expect(result.current.get(incoming.id)).not.toHaveProperty("foldedIntoRequestId");
    expect(result.current.get(original.id)?.transaction).toBeUndefined();
  });
  it.each([undefined, "another-request"])("keeps receipt separate when payment request binding is %s", async (requestId) => {
    mocks.getById.mockResolvedValue({ ...receipt, metadata: { paymentDelivery: { ...receipt.metadata.paymentDelivery, requestId } } });
    const original = { ...request, outgoing: true };
    const { result } = renderHook(() => useChatPaymentRecords([original, incoming], true));
    await waitFor(() => expect(result.current.get(incoming.id)?.status).toBe("settled"));
    expect(result.current.get(incoming.id)).not.toHaveProperty("foldedIntoRequestId");
    expect(result.current.get(original.id)?.transaction).toBeUndefined();
  });
  it("uses the approved local transaction mapping while retaining authenticated identity checks", async () => {
    mocks.findProcessed.mockResolvedValue({ result: "success", txId: "approved-local" });
    mocks.getById.mockResolvedValue({ ...receipt, id: "approved-local", amount: { value: 1198n, unit: "sat" } });
    const { result } = renderHook(() => useChatPaymentRecords([incoming], true));
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe("settled"));
    expect(mocks.getById).toHaveBeenCalledWith("approved-local");
    mocks.getById.mockResolvedValue({ ...receipt, id: "approved-local", metadata: undefined });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe("unknown"));
  });
  it.each([
    { sender: "d".repeat(64) },
    { recipient: "d".repeat(64) },
    { id: "d".repeat(64) },
    { amount: 1201 },
  ])("rejects a different authenticated receipt binding %#", async (patch) => {
    mocks.getById.mockResolvedValue({
      ...receipt,
      metadata: {
        paymentDelivery: { ...receipt.metadata.paymentDelivery, ...patch },
      },
    });
    const { result } = renderHook(() =>
      useChatPaymentRecords([incoming], true)
    );
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unknown")
    );
    expect(result.current.get(message.id)?.transaction).toBeUndefined();
  });
  it("does not treat pending redemption as received", async () => {
    mocks.getById.mockResolvedValue({ ...receipt, status: "pending" });
    const { result } = renderHook(() =>
      useChatPaymentRecords([incoming], true)
    );
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("pending")
    );
  });
  it("rejects an unverified transaction even with an exact amount and ID", async () => {
    mocks.getById.mockResolvedValue({ ...receipt, metadata: undefined });
    const { result } = renderHook(() =>
      useChatPaymentRecords([incoming], true)
    );
    await waitFor(() =>
      expect(result.current.get(message.id)?.status).toBe("unknown")
    );
  });
});

describe("request payment presentation", () => {
  it("keeps a settled payment independent and links its transaction to the request", async () => {
    mocks.getById.mockResolvedValue({ ...transaction, status: "settled", outcome: "claimed" });
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() => expect(result.current.get(request.id)?.transaction?.id).toBe(transaction.id));
    expect(result.current.get(message.id)?.transaction?.id).toBe(transaction.id);
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
  });

  it.each(["pending", "unclaimed"])("keeps trusted %s payments independent with request transaction details", async (status) => {
    mocks.getById.mockResolvedValue({ ...transaction, status: "pending", outcome: status === "unclaimed" ? "unclaimed" : undefined });
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() => expect(result.current.get(request.id)?.transaction?.id).toBe(transaction.id));
    expect(result.current.get(request.id)?.status).toBe(status);
    expect(result.current.get(request.id)?.transaction?.id).toBe(transaction.id);
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
  });

  it.each(["failed", "cancelled"])("keeps %s payment attempts visible", async (status) => {
    mocks.getById.mockResolvedValue({ ...transaction, status, outcome: undefined });
    const { result } = renderHook(() => useChatPaymentRecords([request, message], true));
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe(status));
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
  });

  it.each([
    { conversationId: "another" },
    { sender: "c".repeat(64) },
    { recipient: "c".repeat(64) },
    { outgoing: true },
    { content: "ordinary text" },
    { id: "missing-request" },
  ])("does not attach a payment to a mismatched request %#", async (patch) => {
    mocks.getById.mockResolvedValue({ ...transaction, status: "settled" });
    const { result } = renderHook(() => useChatPaymentRecords([{ ...request, ...patch }, message], true));
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe("settled"));
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
    expect(result.current.get(patch.id ?? request.id)?.transaction).toBeUndefined();
  });

  it("does not attach a payment to a different requested amount or an absent request", async () => {
    mocks.getById.mockResolvedValue({ ...transaction, status: "settled" });
    mocks.decodeCashuRequest.mockReturnValue({ amount: 1201, unit: "sat" });
    const { result, rerender } = renderHook(({ messages }) => useChatPaymentRecords(messages, true), { initialProps: { messages: [request, message] } });
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe("settled"));
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
    expect(result.current.get(request.id)?.transaction).toBeUndefined();
    rerender({ messages: [message] });
    await waitFor(() => expect(result.current.get(message.id)?.status).toBe("settled"));
    expect(result.current.get(message.id)).not.toHaveProperty("foldedIntoRequestId");
  });

  it("keeps every completed payment in the timeline", async () => {
    mocks.getById.mockResolvedValue({ ...transaction, status: "settled" });
    const second = { ...message, id: "second-notice" };
    const { result } = renderHook(() => useChatPaymentRecords([request, message, second], true));
    await waitFor(() => expect(result.current.get(request.id)?.status).toBe("settled"));
    for (const item of [message, second]) {
      expect(result.current.get(item.id)?.status).toBe("settled");
      expect(result.current.get(item.id)).not.toHaveProperty("foldedIntoRequestId");
    }
  });
});

it("does not attach one verified transaction to multiple request cards", async () => {
  mocks.getById.mockResolvedValue({ ...transaction, status: "settled" });
  const otherRequest = { ...request, id: "other-request" };
  const otherNotice: ChatMessage = { ...message, id: "other-notice", content: encodeChatPaymentNotice({ ...notice, requestMessageId: otherRequest.id }), payment: { kind: "send", amount: 1200, transactionId: "tx-1", requestMessageId: otherRequest.id } };
  const { result } = renderHook(() => useChatPaymentRecords([request, otherRequest, message, otherNotice], true));
  await waitFor(() => expect(result.current.get(message.id)?.status).toBe("settled"));
  expect([request, otherRequest].filter((m) => result.current.get(m.id)?.transaction)).toHaveLength(1);
  for (const item of [message, otherNotice]) {
    expect(result.current.get(item.id)?.status).toBe("settled");
    expect(result.current.get(item.id)).not.toHaveProperty("foldedIntoRequestId");
  }
});
