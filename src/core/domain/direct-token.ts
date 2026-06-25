/**
 * direct-token — NUT-18 Direct Token 파싱 순수 함수
 *
 * NIP-17 DM(kind 14)에서 cashu 토큰을 추출.
 * I/O 없음, 외부 의존 없음.
 */

export interface DirectTokenMessage {
  token: string;
  memo?: string;
  mintUrl?: string;
  amount?: number;
  senderPubkey: string;
  createdAt: number;
}

interface Rumor {
  kind: number;
  tags: string[][];
  content: string;
  pubkey: string;
  created_at: number;
}

const PRIVATE_DM_KIND = 14;

/**
 * DM rumor에서 Direct Token 추출.
 * kind 14가 아니거나 cashu 토큰이 없으면 null.
 */
export function parseDirectToken(rumor: Rumor): DirectTokenMessage | null {
  if (rumor.kind !== PRIVATE_DM_KIND) return null;

  let token: string | null = null;

  for (const tag of rumor.tags) {
    if (tag[0] === "cashu" && tag[1]) {
      token = tag[1];
    }
  }

  if (!token && rumor.content) {
    const content = rumor.content.trim();
    if (content.startsWith("cashuA") || content.startsWith("cashuB")) {
      token = content;
    }
  }

  if (!token) return null;

  let mintUrl: string | undefined;
  let amount: number | undefined;
  let tokenMemo: string | undefined;

  try {
    const parsed = parseTokenBasic(token);
    mintUrl = parsed.mint;
    amount = parsed.amount;
    tokenMemo = parsed.memo;
  } catch {
    // Token will be validated on receive
  }

  return {
    token,
    memo: tokenMemo,
    mintUrl,
    amount,
    senderPubkey: rumor.pubkey,
    createdAt: rumor.created_at,
  };
}

/**
 * Basic token parsing to extract mint URL and total amount.
 */
function parseTokenBasic(token: string): {
  mint: string;
  amount: number;
  memo?: string;
} {
  const prefix = token.startsWith("cashuA") ? "cashuA" : "cashuB";
  const base64 = token.slice(prefix.length).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  const data = JSON.parse(json);

  if (prefix === "cashuA") {
    const tokenData = data.token?.[0];
    const mint = tokenData?.mint || "";
    const proofs = tokenData?.proofs || [];
    const amount = proofs.reduce(
      (sum: number, p: { amount: number }) => sum + p.amount,
      0
    );
    const memo = typeof data.memo === "string" ? data.memo : undefined;

    return { mint, amount, memo };
  } else {
    const mint = data.m || "";
    const proofs =
      data.t?.flatMap(
        (t: { p: Array<{ a: number }> }) =>
          t.p?.map((p) => ({ amount: p.a })) || []
      ) || [];
    const amount = proofs.reduce(
      (sum: number, p: { amount: number }) => sum + p.amount,
      0
    );
    const memo = typeof data.d === "string" ? data.d : undefined;
    return { mint, amount, memo };
  }
}
