import { afterEach, describe, expect, it } from "vitest";
import { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";
import { getDatabase, resetDatabase } from "@/adapters/storage/dexie/schema";
import { createPendingTransfer } from "@/core/domain/pending-transfer";

afterEach(() => resetDatabase());

describe("incoming receive checkpoints", () => {
  it("preserves receive operation identity and delivery metadata across database reopen", async () => {
    await resetDatabase();
    const store = new DexiePendingTransferStore();
    await store.create(
      createPendingTransfer({
        id: "incoming",
        txId: "delivery",
        direction: "incoming",
        finality: "deferred",
        onExpiry: "expire",
        now: 1,
        transportRef: {
          protocol: "ecash",
          type: "nostr-giftwrap",
          sender: "sender",
          recipientPubkey: "recipient",
          token: "token",
        },
      })
    );
    await store.update("incoming", {
      phase: "submitted",
      transportRef: {
        ...((await store.get("incoming"))!.transportRef as object),
        receiveOperationId: "same-operation",
      },
    });
    getDatabase().close();
    await getDatabase().open();
    const reopened = new DexiePendingTransferStore();
    expect((await reopened.listActive())[0].transportRef).toMatchObject({
      receiveOperationId: "same-operation",
      sender: "sender",
      recipientPubkey: "recipient",
      token: "token",
    });
  });
});
