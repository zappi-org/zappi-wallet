import {
  encodeChatPaymentNotice,
  parseChatPaymentLink,
  parseChatPaymentNotice,
} from "@/core/domain/chat-payment";
import type { ChatMessage } from "@/core/domain/chat";
import type { Transaction } from "@/core/domain/transaction";
import type { ChatPaymentLink } from "@/core/domain/chat-payment";
import type { RouteExecutionResult } from "@/core/domain/routing";

export interface ChatPaymentLaunch {
  conversationId: string;
  peer: string;
  requestMessageId?: string;
  expiresAt?: number;
}

export async function hasSubmittedChatRequest(
  launch: ChatPaymentLaunch,
  messages: readonly ChatMessage[],
  getTransaction: (id: string) => Promise<Transaction | null>,
  submittedInSession = false,
): Promise<boolean> {
  if (!launch.requestMessageId) return false;
  if (submittedInSession) return true;
  for (const message of messages) {
    if (
      !message.outgoing ||
      message.conversationId !== launch.conversationId ||
      message.recipient !== launch.peer
    ) continue;
    const link = parseChatPaymentLink(message.payment);
    if (
      link?.kind !== "send" ||
      link.requestMessageId !== launch.requestMessageId
    ) continue;
    const notice = parseChatPaymentNotice(message.content);
    if (
      !notice ||
      notice.recipient !== launch.peer ||
      notice.transactionId !== link.transactionId ||
      notice.amount !== link.amount ||
      notice.requestMessageId !== launch.requestMessageId
    ) continue;
    const transaction = await getTransaction(link.transactionId);
    // A missing wallet record cannot establish that retrying is safe.
    if (!transaction) throw new Error("Chat payment transaction unavailable");
    if (
      transaction.id === link.transactionId &&
      transaction.direction === "send" &&
      transaction.amount.unit === "sat" &&
      transaction.amount.value === BigInt(link.amount) &&
      transaction.status !== "failed"
    ) return true;
  }
  return false;
}

const executingRequests = new Set<string>();

/** Announcing a payment must never change its execution result or retry it. */
export async function executeChatPayment(
  launch: ChatPaymentLaunch,
  execute: () => Promise<RouteExecutionResult | null>,
  enqueue: (
    id: string,
    content: string,
    link: ChatPaymentLink
  ) => Promise<void>,
  onSubmitted: () => void = () => undefined,
  isSubmitted: () => boolean | Promise<boolean> = () => false,
) {
  const key = launch.requestMessageId
    ? JSON.stringify([launch.conversationId, launch.peer, launch.requestMessageId])
    : undefined;
  const blocked = (duplicate: boolean, expired = false) => ({
    result: null, noticeSaved: Promise.resolve(true), expired, duplicate,
  });
  if (key && executingRequests.has(key)) return blocked(true);
  if (key) executingRequests.add(key);
  try {
    if (key && await isSubmitted()) return blocked(true);
    if (launch.expiresAt !== undefined && launch.expiresAt <= Date.now())
      return blocked(false, true);
    const result = await execute();
    if (!result || result.status === "failed")
      return { result, noticeSaved: Promise.resolve(true), expired: false, duplicate: false };
    const noticeSaved = (async () => {
      onSubmitted();
      const content = encodeChatPaymentNotice({
        amount: result.amount,
        unit: "sat",
        recipient: launch.peer,
        deliveryId: result.deliveryId,
        transactionId: result.transactionId,
        requestMessageId: launch.requestMessageId,
      });
      await enqueue(launch.conversationId, content, {
        kind: "send",
        amount: result.amount,
        transactionId: result.transactionId,
        requestMessageId: launch.requestMessageId,
      });
      return true;
    })().catch(() => false);
    return { result, noticeSaved, expired: false, duplicate: false };
  } finally {
    if (key) executingRequests.delete(key);
  }
}
