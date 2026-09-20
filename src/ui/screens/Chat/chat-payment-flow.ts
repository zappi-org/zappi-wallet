import { encodeChatPaymentNotice } from "@/core/domain/chat-payment";
import type { ChatPaymentLink } from "@/core/domain/chat-payment";
import type { RouteExecutionResult } from "@/core/domain/routing";

export interface ChatPaymentLaunch {
  conversationId: string;
  peer: string;
  requestMessageId?: string;
  expiresAt?: number;
}

/** Announcing a payment must never change its execution result or retry it. */
export async function executeChatPayment(
  launch: ChatPaymentLaunch,
  execute: () => Promise<RouteExecutionResult | null>,
  enqueue: (
    id: string,
    content: string,
    link: ChatPaymentLink
  ) => Promise<void>,
  onSubmitted: () => void = () => undefined
) {
  if (launch.expiresAt !== undefined && launch.expiresAt <= Date.now())
    return { result: null, noticeSaved: Promise.resolve(true), expired: true };
  const result = await execute();
  if (!result || result.status === "failed")
    return { result, noticeSaved: Promise.resolve(true), expired: false };
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
  return { result, noticeSaved, expired: false };
}
