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

/**
 * refresh 발화 계약 (감사 잔여 Phase 0, 리뷰 MAJOR-16 보강)
 *
 * 이 브리지가 거래내역 DB 를 바꾸고도 triggerTxRefresh 를 쏘지 않으면
 * UI 는 다음 수동 새로고침까지 돈의 상태 변화를 보여주지 못한다.
 * 각 생명주기 이벤트가 "DB 반영 후 refresh 발화"를 지키는지 핀한다.
 */
describe("TransferTxBridge - refresh 발화 계약", () => {
  function makeBridge(opts: {
    event: string;
    transfer: Record<string, unknown>;
    reason?: string;
    existingTx?: Record<string, unknown> | null;
  }) {
    const triggerTxRefresh = vi.fn();
    const mockTxRepo = {
      getById: vi.fn().mockResolvedValue(opts.existingTx ?? null),
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    };
    const mockEventBus = {
      on: vi.fn((event, handler) => {
        if (event === opts.event) {
          handler({ payload: { transfer: opts.transfer, reason: opts.reason } });
        }
        return () => {};
      }),
    };
    connectTransferTxBridge({
      eventBus: mockEventBus as unknown as EventBus,
      txRepo: mockTxRepo as unknown as TransactionRepository,
      triggerTxRefresh,
    });
    return { triggerTxRefresh, mockTxRepo };
  }

  const baseTransfer = {
    id: "transfer-r1",
    txId: "tx-r1",
    direction: "outgoing",
    phase: "submitted",
    amount: 1000,
    transportRef: { type: "cashu-token", token: "cashuAtest" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("transfer:submitted → pending TX 저장 후 refresh 발화", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:submitted",
      transfer: baseTransfer,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledOnce();
    expect(triggerTxRefresh).toHaveBeenCalledOnce();
  });

  it("transfer:submitted 중복(기존 TX 존재) → 저장·refresh 모두 없음", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:submitted",
      transfer: baseTransfer,
      existingTx: { id: "tx-r1", status: "pending" },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).not.toHaveBeenCalled();
    expect(triggerTxRefresh).not.toHaveBeenCalled();
  });

  it("transfer:settled(기존 TX) → claimed 업데이트 후 refresh 발화", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:settled",
      transfer: { ...baseTransfer, phase: "settled" },
      existingTx: {
        id: "tx-r1",
        status: "pending",
        protocol: "cashu-token",
        metadata: {},
      },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.update).toHaveBeenCalledWith(
      "tx-r1",
      expect.objectContaining({ status: "settled", outcome: "claimed" }),
    );
    expect(triggerTxRefresh).toHaveBeenCalled();
  });

  it("transfer:reclaimed → reclaimed 업데이트 후 refresh 발화", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:reclaimed",
      transfer: baseTransfer,
      existingTx: { id: "tx-r1", status: "pending", metadata: {} },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.update).toHaveBeenCalledWith(
      "tx-r1",
      expect.objectContaining({ status: "settled", outcome: "reclaimed" }),
    );
    expect(triggerTxRefresh).toHaveBeenCalledOnce();
  });

  it("transfer:failed(기존 TX) → failed 업데이트(+사유 보존) 후 refresh 발화", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:failed",
      transfer: baseTransfer,
      reason: "mint unreachable",
      existingTx: { id: "tx-r1", status: "pending", metadata: {} },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.update).toHaveBeenCalledWith(
      "tx-r1",
      expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({ error: "mint unreachable" }),
      }),
    );
    expect(triggerTxRefresh).toHaveBeenCalledOnce();
  });

  it("transfer:failed(TX 없음) → failed TX 신규 생성 후 refresh 발화", async () => {
    const { triggerTxRefresh, mockTxRepo } = makeBridge({
      event: "transfer:failed",
      transfer: baseTransfer,
      reason: "mint unreachable",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTxRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tx-r1", status: "failed" }),
    );
    expect(triggerTxRefresh).toHaveBeenCalledOnce();
  });
});
