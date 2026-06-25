import { describe, it, expect } from "vitest";
import { parseDirectToken } from "@/core/domain/direct-token";

const makeRumor = (
  overrides: Partial<{
    kind: number;
    tags: string[][];
    content: string;
    pubkey: string;
    created_at: number;
  }> = {}
) => ({
  kind: 14,
  tags: [],
  content: "",
  pubkey: "sender-pubkey-hex",
  created_at: 1700000000,
  ...overrides,
});

describe("parseDirectToken", () => {
  it("extracts token from cashu tag", () => {
    const rumor = makeRumor({
      tags: [["cashu", "cashuBtoken123"]],
    });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("cashuBtoken123");
    expect(result!.senderPubkey).toBe("sender-pubkey-hex");
    expect(result!.createdAt).toBe(1700000000);
  });

  it("extracts token from content when no cashu tag", () => {
    const rumor = makeRumor({
      content: "cashuBtoken456",
    });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("cashuBtoken456");
  });

  it("extracts cashuA token from content", () => {
    const rumor = makeRumor({
      content: "cashuAtoken789",
    });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("cashuAtoken789");
  });

  it("treats non-token content as memo", () => {
    const rumor = makeRumor({
      tags: [["cashu", "cashuBtoken"]],
      content: "Thanks for lunch!",
    });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("cashuBtoken");
    // memo is not set when cashu tag is found (content not parsed as memo in that case)
  });

  it("returns null for non-DM kind", () => {
    const rumor = makeRumor({ kind: 1 });

    expect(parseDirectToken(rumor)).toBeNull();
  });

  it("returns null when no cashu token found", () => {
    const rumor = makeRumor({
      content: "just a regular message",
    });

    expect(parseDirectToken(rumor)).toBeNull();
  });

  it("returns null for empty rumor", () => {
    const rumor = makeRumor();

    expect(parseDirectToken(rumor)).toBeNull();
  });

  it("prefers cashu tag over content", () => {
    const rumor = makeRumor({
      tags: [["cashu", "cashuBfromTag"]],
      content: "cashuBfromContent",
    });

    const result = parseDirectToken(rumor);

    expect(result!.token).toBe("cashuBfromTag");
  });
});

// ─────────────────────────────────────────────────────────────
// Fixture helpers: encode a JSON object as a cashuA / cashuB token
// (UTF-8 safe — uses TextEncoder to handle Korean / emoji memos).
// ─────────────────────────────────────────────────────────────

const encodeToken = (prefix: "cashuA" | "cashuB", obj: unknown): string => {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return prefix + b64;
};

describe("parseDirectToken memo extraction", () => {
  it("extracts memo from cashuB token (data.d) via cashu tag", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      d: "hello",
      t: [{ p: [{ a: 100 }] }],
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.memo).toBe("hello");
    expect(result!.amount).toBe(100);
    expect(result!.mintUrl).toBe("https://mint.example");
  });

  it("extracts memo from cashuB token via content (no cashu tag)", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      d: "lunch money",
      t: [{ p: [{ a: 21 }] }],
    });
    const rumor = makeRumor({ content: token });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.memo).toBe("lunch money");
  });

  it("extracts memo from cashuA token (data.memo) via cashu tag", () => {
    const token = encodeToken("cashuA", {
      token: [{ mint: "https://mint.example", proofs: [{ amount: 50 }] }],
      unit: "sat",
      memo: "thanks",
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    const result = parseDirectToken(rumor);

    expect(result).not.toBeNull();
    expect(result!.memo).toBe("thanks");
    expect(result!.amount).toBe(50);
  });

  it("returns memo=undefined when token has no memo field", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      t: [{ p: [{ a: 50 }] }],
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    expect(parseDirectToken(rumor)!.memo).toBeUndefined();
  });

  it("ignores non-string memo fields (number, null, missing)", () => {
    const cases = [
      encodeToken("cashuB", { m: "m", u: "sat", d: 12345, t: [{ p: [{ a: 1 }] }] }),
      encodeToken("cashuB", { m: "m", u: "sat", d: null, t: [{ p: [{ a: 1 }] }] }),
      encodeToken("cashuB", { m: "m", u: "sat", t: [{ p: [{ a: 1 }] }] }),
    ];
    for (const token of cases) {
      const rumor = makeRumor({ tags: [["cashu", token]] });
      expect(parseDirectToken(rumor)!.memo).toBeUndefined();
    }
  });
});

describe("parseDirectToken UTF-8 safety", () => {
  it("decodes Korean memo from cashuB token", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      d: "점심값",
      t: [{ p: [{ a: 100 }] }],
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    const result = parseDirectToken(rumor);

    expect(result!.memo).toBe("점심값");
  });

  it("decodes Japanese memo from cashuB token", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      d: "ランチ代",
      t: [{ p: [{ a: 100 }] }],
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    expect(parseDirectToken(rumor)!.memo).toBe("ランチ代");
  });

  it("decodes emoji memo from cashuA token", () => {
    const token = encodeToken("cashuA", {
      token: [{ mint: "https://mint.example", proofs: [{ amount: 21 }] }],
      unit: "sat",
      memo: "☕ coffee",
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    expect(parseDirectToken(rumor)!.memo).toBe("☕ coffee");
  });

  it("decodes multi-byte unicode (4-byte) emoji from cashuB token", () => {
    const token = encodeToken("cashuB", {
      m: "https://mint.example",
      u: "sat",
      d: "🚀 launch",
      t: [{ p: [{ a: 100 }] }],
    });
    const rumor = makeRumor({ tags: [["cashu", token]] });

    expect(parseDirectToken(rumor)!.memo).toBe("🚀 launch");
  });
});
