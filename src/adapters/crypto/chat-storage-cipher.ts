import type { ChatStorageCipher } from "@/core/ports/driven/chat-storage-cipher.port";
import type { ChatStorageKeyStore } from "@/core/ports/driven/chat-storage-key-store.port";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function seal(
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data
  );
  return JSON.stringify({
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
}

async function open(
  key: CryptoKey,
  value: string,
  aad: Uint8Array<ArrayBuffer>
) {
  const envelope: unknown = JSON.parse(value);
  if (!envelope || typeof envelope !== "object")
    throw new Error("Invalid chat ciphertext");
  const record = envelope as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.iv !== "string" ||
    typeof record.ciphertext !== "string"
  )
    throw new Error("Unsupported chat ciphertext");
  const iv = decode(record.iv);
  const ciphertext = decode(record.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 16)
    throw new Error("Invalid chat ciphertext");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      ciphertext
    )
  );
}

export class ChatStorageCipherAdapter implements ChatStorageCipher {
  private key: CryptoKey | null = null;
  private generation = 0;

  constructor(
    private readonly account: string,
    private readonly keyStore: ChatStorageKeyStore
  ) {}

  async unlock(seed: Uint8Array): Promise<void> {
    this.lock();
    const generation = this.generation;
    const material = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(seed),
      "HKDF",
      false,
      ["deriveKey"]
    );
    const wrappingKey = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(this.account),
        info: encoder.encode("zappi/chat-storage/wrap/v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    let unwrapped: Uint8Array<ArrayBuffer> | undefined;
    try {
      const aad = encoder.encode(
        JSON.stringify(["zappi/chat-storage/key", 1, this.account])
      );
      const wrappedKey = await seal(wrappingKey, rawKey, aad);
      if (generation !== this.generation)
        throw new Error("Chat storage locked");
      const record = await this.keyStore.getOrCreate(this.account, {
        account: this.account,
        version: 1,
        wrappedKey,
      });
      if (record.account !== this.account || record.version !== 1)
        throw new Error("Invalid chat storage key");
      unwrapped = await open(wrappingKey, record.wrappedKey, aad);
      if (unwrapped.length !== 32) throw new Error("Invalid chat storage key");
      const key = await crypto.subtle.importKey(
        "raw",
        unwrapped,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
      if (generation !== this.generation)
        throw new Error("Chat storage locked");
      this.key = key;
    } finally {
      rawKey.fill(0);
      unwrapped?.fill(0);
    }
  }

  lock(): void {
    this.generation++;
    this.key = null;
  }

  assertUnlocked(): void {
    if (!this.key) throw new Error("Chat storage locked");
  }

  captureGuard(): () => void {
    this.assertUnlocked();
    const generation = this.generation;
    return () => {
      this.assertUnlocked();
      if (generation !== this.generation)
        throw new Error("Chat storage session changed");
    };
  }

  private aad(context: readonly string[]) {
    return encoder.encode(
      JSON.stringify(["zappi/chat-storage/data", 1, this.account, ...context])
    );
  }

  async encrypt(value: string, context: readonly string[]): Promise<string> {
    this.assertUnlocked();
    const generation = this.generation;
    const ciphertext = await seal(
      this.key!,
      encoder.encode(value),
      this.aad(context)
    );
    if (generation !== this.generation) throw new Error("Chat storage locked");
    return ciphertext;
  }

  async decrypt(value: string, context: readonly string[]): Promise<string> {
    this.assertUnlocked();
    const generation = this.generation;
    const plaintext = await open(this.key!, value, this.aad(context));
    try {
      if (generation !== this.generation)
        throw new Error("Chat storage locked");
      return decoder.decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }
}
