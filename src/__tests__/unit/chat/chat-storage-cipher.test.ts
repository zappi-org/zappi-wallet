import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStorageCipherAdapter } from "@/adapters/crypto/chat-storage-cipher";
import { DexieChatKeyStore } from "@/adapters/storage/dexie/dexie-chat-key-store";
import { getDatabase, resetDatabase } from "@/adapters/storage/dexie/schema";
import type { ChatStorageKeyRecord } from "@/core/ports/driven/chat-storage-key-store.port";

const account = "a".repeat(64);
const seed = new Uint8Array(64).fill(7);
const context = ["message", `${account}:direct:peer`, "id", "content"];
const create = (owner = account) =>
  new ChatStorageCipherAdapter(owner, new DexieChatKeyStore());

beforeEach(async () => {
  await resetDatabase();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

describe("chat storage key protection", () => {
  it("reopens a dedicated key using the same seed and stores no raw key", async () => {
    const cipher = create();
    await cipher.unlock(seed);
    const encrypted = await cipher.encrypt("private message", context);
    expect(encrypted).not.toContain("private message");
    const key = await getDatabase().chatStorageKeys.get(account);
    expect(Object.keys(key!).sort()).toEqual([
      "account",
      "version",
      "wrappedKey",
    ]);
    cipher.lock();
    const reopened = create();
    await reopened.unlock(seed);
    expect(await reopened.decrypt(encrypted, context)).toBe("private message");
  });

  it("uses fresh IVs and authenticates context and ciphertext", async () => {
    const cipher = create();
    await cipher.unlock(seed);
    const encrypted = await cipher.encrypt("secret", context);
    expect(await cipher.encrypt("secret", context)).not.toBe(encrypted);
    await expect(
      cipher.decrypt(encrypted, [...context, "other"])
    ).rejects.toThrow();
    const modified = JSON.parse(encrypted);
    modified.ciphertext =
      (modified.ciphertext.startsWith("A") ? "B" : "A") +
      modified.ciphertext.slice(1);
    await expect(
      cipher.decrypt(JSON.stringify(modified), context)
    ).rejects.toThrow();
    await expect(
      cipher.decrypt(JSON.stringify({ ...modified, version: 2 }), context)
    ).rejects.toThrow();
  });

  it("rejects wrong seed and moved account wrappers without replacing the key", async () => {
    const cipher = create();
    await cipher.unlock(seed);
    const key = await getDatabase().chatStorageKeys.get(account);
    await expect(create().unlock(new Uint8Array(64).fill(8))).rejects.toThrow();
    expect(await getDatabase().chatStorageKeys.get(account)).toEqual(key);
    const other = "b".repeat(64);
    await getDatabase().chatStorageKeys.put({ ...key!, account: other });
    await expect(create(other).unlock(seed)).rejects.toThrow();
  });

  it("concurrent sessions converge to the committed winning key", async () => {
    const first = create();
    const second = create();
    await Promise.all([first.unlock(seed), second.unlock(seed)]);
    const encrypted = await first.encrypt("shared", context);
    expect(await second.decrypt(encrypted, context)).toBe("shared");
    expect(await getDatabase().chatStorageKeys.count()).toBe(1);
  });

  it("rejects reads, writes and stale guards after lock and unlock", async () => {
    const cipher = create();
    await cipher.unlock(seed);
    const encrypted = await cipher.encrypt("secret", context);
    const guard = cipher.captureGuard();
    const pending = cipher.decrypt(encrypted, context);
    cipher.lock();
    await expect(pending).rejects.toThrow("locked");
    await expect(cipher.encrypt("secret", context)).rejects.toThrow("locked");
    await cipher.unlock(seed);
    expect(guard).toThrow("session changed");
  });

  it("cannot revive a session when lock occurs during key initialization", async () => {
    let release!: (record: ChatStorageKeyRecord) => void;
    let candidate!: ChatStorageKeyRecord;
    const reached = vi.fn();
    const cipher = new ChatStorageCipherAdapter(account, {
      getOrCreate: async (_account, record) => {
        candidate = record;
        reached();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = cipher.unlock(seed);
    await vi.waitFor(() => expect(reached).toHaveBeenCalled());
    cipher.lock();
    release(candidate);
    await expect(pending).rejects.toThrow("locked");
    expect(() => cipher.assertUnlocked()).toThrow("locked");
  });

  it("does not replace a missing key when encrypted messages remain", async () => {
    const cipher = create();
    await cipher.unlock(seed);
    await getDatabase().chatMessages.put({
      id: "id",
      conversationId: `${account}:direct:peer`,
      content: "encrypted",
      sender: "peer",
      recipient: account,
      outgoing: false,
      createdAt: 1,
      status: "received",
      storageVersion: 1,
    });
    await getDatabase().chatStorageKeys.delete(account);
    await expect(create().unlock(seed)).rejects.toThrow("key missing");
    expect(await getDatabase().chatStorageKeys.count()).toBe(0);
  });
});
