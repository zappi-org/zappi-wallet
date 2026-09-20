import type {
  ChatStorageKeyRecord,
  ChatStorageKeyStore,
} from "@/core/ports/driven/chat-storage-key-store.port";
import { getDatabase } from "./schema";

export class DexieChatKeyStore implements ChatStorageKeyStore {
  async getOrCreate(
    account: string,
    candidate: ChatStorageKeyRecord
  ): Promise<ChatStorageKeyRecord> {
    if (candidate.account !== account || candidate.version !== 1)
      throw new Error("Invalid chat storage key");
    const db = getDatabase();
    return db.transaction(
      "rw",
      [db.chatStorageKeys, db.chatConversations, db.chatMessages],
      async () => {
        const existing = await db.chatStorageKeys.get(account);
        if (existing) return existing;
        const conversation = await db.chatConversations
          .where("account")
          .equals(account)
          .filter((row) => row.storageVersion !== undefined)
          .first();
        const message = await db.chatMessages
          .where("conversationId")
          .startsWith(`${encodeURIComponent(account)}:`)
          .filter((row) => row.storageVersion !== undefined)
          .first();
        if (conversation || message)
          throw new Error("Chat storage key missing");
        await db.chatStorageKeys.add(candidate);
        return candidate;
      }
    );
  }
}
