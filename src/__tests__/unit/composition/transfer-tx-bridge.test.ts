import { describe, it, expect, vi } from "vitest";
import { connectTransferTxBridge } from "@/composition/transfer-tx-bridge";
import type { EventBus } from "@/core/events/event-bus";
import type { TransactionRepository } from "@/core/ports/driven/transaction.repository.port";

describe("TransferTxBridge - bolt 11 outgoing fee", () => {
  it("records both quoted and effective fee when effectiveFee is present", async () => {
    const mockTransfer = {
      id: "transfer-1",
      txId: "tx-1",
      direction: "outgoing",
      phase: "settled",
      finality: "immediate",
      onExpiry: "fail",
      amount: 10000,
      transportRef: {
        type: "bolt11-melt",
        feeReserve: 150,
        effectiveFee: 120,
        operationId: "op-1",
        request: "lnbc...",
        preimage: "preimage-abc",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockTxRepo = {
      getById: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const mockEventBus = {
      on: vi.fn((event, handler) => {
        if (event === "transfer:submitted") {
          handler({ payload: { transfer: mockTransfer } });
        }
        return () => {};
      }),
    };
    connectTransferTxBridge({
      eventBus: mockEventBus as unknown as EventBus,
      txRepo: mockTxRepo as unknown as TransactionRepository,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledOnce();
    const savedTx = mockTxRepo.save.mock.calls[0][0];

    expect(savedTx.fee).toEqual({
      quoted: { value: 150n, unit: "sat" },
      effective: { value: 120n, unit: "sat" },
    });
    expect(savedTx.status).toBe("settled");
  });

  it("records only quoted fee when effective is absent (in_transit)", async () => {
    const mockTransfer = {
      id: "transfer-1",
      txId: "tx-1",
      direction: "outgoing",
      phase: "in_transit",
      finality: "immediate",
      onExpiry: "fail",
      amount: 10000,
      transportRef: {
        type: "bolt11-melt",
        feeReserve: 150,
        operationId: "op-1",
        request: "lnbc...",
        preimage: "preimage-abc",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const mockTxRepo = {
      getById: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const mockEventBus = {
      on: vi.fn((event, handler) => {
        if (event === "transfer:submitted") {
          handler({ payload: { transfer: mockTransfer } });
        }
        return () => {};
      }),
    };

    connectTransferTxBridge({
      eventBus: mockEventBus as unknown as EventBus,
      txRepo: mockTxRepo as unknown as TransactionRepository,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledOnce();
    const savedTx = mockTxRepo.save.mock.calls[0][0];

    expect(savedTx.fee).toEqual({
      quoted: { value: 150n, unit: "sat" },
    });

    expect(savedTx.status).toBe("pending");
  });
});

describe("TransferTxBridge - incoming ecash fee", () => {
  it("records effective fee when incoming ecash redeem has a swap fee", async () => {
    const mockTransfer = {
      id: "transfer-incoming",
      txId: "tx-incoming",
      direction: "incoming",
      phase: "settled",
      finality: "deferred",
      onExpiry: "expire",
      amount: 5002, // gross amount (proof 총액)
      transportRef: {
        type: "nostr-giftwrap",
        protocol: "ecash",
        token: "cashuAeyJ0b2tlbiI6...",
        fee: 2,
        receivedAmount: 5000, // net 수령액
        mintUrl: "https://mint.test",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockTxRepo = {
      getById: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const mockEventBus = {
      on: vi.fn((event, handler) => {
        if (event === "transfer:settled") {
          handler({ payload: { transfer: mockTransfer } });
        }
        return () => {};
      }),
    };

    connectTransferTxBridge({
      eventBus: mockEventBus as unknown as EventBus,
      txRepo: mockTxRepo as unknown as TransactionRepository,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledOnce();
    const savedTx = mockTxRepo.save.mock.calls[0][0];

    expect(savedTx.direction).toBe("receive");
    expect(savedTx.status).toBe("settled");
    // 거래내역 금액은 gross(토큰 액면가)로 저장, 수수료는 별도로 표시
    expect(savedTx.amount).toEqual({ value: 5002n, unit: "sat" });
    expect(savedTx.fee).toEqual({
      quoted: { value: 0n, unit: "sat" },
      effective: { value: 2n, unit: "sat" },
    });
  });

  it("does not record fee when incoming ecash redeem has zero fee", async () => {
    const mockTransfer = {
      id: "transfer-incoming-no-fee",
      txId: "tx-incoming-no-fee",
      direction: "incoming",
      phase: "settled",
      finality: "deferred",
      onExpiry: "expire",
      amount: 5000,
      transportRef: {
        type: "nostr-giftwrap",
        protocol: "ecash",
        token: "cashuAeyJ0b2tlbiI6...",
        fee: 0,
        mintUrl: "https://mint.test",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockTxRepo = {
      getById: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const mockEventBus = {
      on: vi.fn((event, handler) => {
        if (event === "transfer:settled") {
          handler({ payload: { transfer: mockTransfer } });
        }
        return () => {};
      }),
    };

    connectTransferTxBridge({
      eventBus: mockEventBus as unknown as EventBus,
      txRepo: mockTxRepo as unknown as TransactionRepository,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledOnce();
    const savedTx = mockTxRepo.save.mock.calls[0][0];

    expect(savedTx.fee).toBeUndefined();
    expect(savedTx.amount).toEqual({ value: 5000n, unit: "sat" });
  });
});
