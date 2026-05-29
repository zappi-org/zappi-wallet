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
