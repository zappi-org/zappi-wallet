import { sat } from "@/core/domain/amount";
import { createTransaction } from "@/core/domain/transaction";
import {
  PaymentRoute,
  type RouteContext,
  type RouteExecutionResult,
  type RouteSelection,
} from "@/core/domain/routing";
import type { EventBus } from "@/core/events/event-bus";
import {
  BaseError,
  PaymentDeliveryFailedError,
  ServiceNotReadyError,
  UnknownError,
} from "@/core/errors";
import type { LnurlGateway } from "@/core/ports/driven/lnurl-gateway.port";
import type { PaymentDeliveryPort } from "@/core/ports/driven/payment-delivery.port";
import type { RouteExecutionStore } from "@/core/ports/driven/route-execution-store.port";
import type { RoutePaymentOperator } from "@/core/ports/driven/route-payment-operator.port";
import type { SyncNotifier } from "@/core/ports/driven/sync-notifier.port";
import type { TokenCodec } from "@/core/ports/driven/token-codec.port";
import type { TransactionRepository } from "@/core/ports/driven/transaction.repository.port";
import type { RouteExecutionUseCase } from "@/core/ports/driving/route-execution.usecase";

import { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";

import { Err, Ok, type Result } from "@/core/domain/result";

export class RouteExecutionService implements RouteExecutionUseCase {
  constructor(
    private readonly paymentOperator: RoutePaymentOperator,
    private readonly txRepo: TransactionRepository,
    private readonly routeStore: RouteExecutionStore,
    private readonly delivery: PaymentDeliveryPort,
    private readonly tokenCodec: TokenCodec,
    private readonly lnurl: Pick<LnurlGateway, "resolvePay" | "fetchInvoice">,
    private readonly eventBus: EventBus,
    private readonly transferLifecycle: TransferLifecycleService,
    private readonly syncNotifier?: SyncNotifier
  ) {}

  async resolveInvoice(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<Result<string, BaseError>> {
    try {
      const invoice = await this.resolveInvoiceValue(selection, context);
      return invoice
        ? Ok(invoice)
        : Err(new UnknownError("Failed to resolve invoice"));
    } catch (error) {
      return Err(toBaseError(error));
    }
  }

  async executeRoute(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<Result<RouteExecutionResult, BaseError>> {
    try {
      switch (selection.route) {
        case PaymentRoute.TOKEN_TRANSFER:
        case PaymentRoute.OWN_MINT_TOKEN:
          return Ok(
            await this.executeTokenSendFlow(
              selection.sourceMintUrl,
              selection,
              context
            )
          );

        case PaymentRoute.LN_INTERNAL:
        case PaymentRoute.LN_CROSS_MINT:
        case PaymentRoute.MELT_TO_LN:
          return Ok(await this.executeMeltToLn(selection, context));

        case PaymentRoute.MINT_AND_DM:
          return Ok(await this.executeMintAndDm(selection, context));

        case PaymentRoute.CANNOT_SEND:
        default:
          return Err(new UnknownError("Cannot determine payment route"));
      }
    } catch (error) {
      return Err(toBaseError(error));
    }
  }

  private async executeMeltToLn(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<RouteExecutionResult> {
    const invoice = await this.resolveInvoiceValue(selection, context);
    if (!invoice) {
      throw new UnknownError("Failed to resolve invoice");
    }
    if (!this.transferLifecycle) {
      throw new ServiceNotReadyError("TransferLifecycleService");
    }
    const transfer = await this.transferLifecycle.initiateTransfer(
      {
        accountId: selection.sourceMintUrl,
        amount: sat(selection.amount),
        recipient: invoice,
        memo: context.memo,
        displayDestination: context.addressOrInvoice,
        txId: `tx-${crypto.randomUUID()}`,
      },
      "bolt11"
    );

    const ref = transfer.transportRef as {
      feeReserve?: number;
      effectiveFee?: number;
    };

    return {
      // Melt phases after initiateTransfer are exactly settled/failed/in_transit;
      // in_transit must not read as failure — the poller finishes it.
      status:
        transfer.phase === "settled"
          ? "settled"
          : transfer.phase === "failed"
            ? "failed"
            : "in_transit",
      amount: selection.amount,
      fee: ref.effectiveFee ?? ref.feeReserve ?? 0,
      effectiveFee: ref.effectiveFee,
      sourceMintUrl: selection.sourceMintUrl,
      transactionId: transfer.txId,
    };
  }
  private async executeMintAndDm(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<RouteExecutionResult> {
    const { sourceMintUrl, targetMintUrl } = selection;
    if (!targetMintUrl) {
      throw new UnknownError("Route #4 requires targetMintUrl");
    }

    let mintQuote: { quote: string; request: string } | undefined;

    try {
      mintQuote = await this.paymentOperator.createMintQuote(
        targetMintUrl,
        selection.amount
      );
      this.paymentOperator.markMintQuoteAsSwap(mintQuote.quote);

      const meltOp = await this.paymentOperator.prepareMelt(
        sourceMintUrl,
        mintQuote.request
      );
      const meltFee = meltOp.feeReserve + meltOp.swapFee;
      await this.routeStore.savePendingMelt({
        quoteId: meltOp.quoteId,
        mintUrl: sourceMintUrl,
        amount: selection.amount,
        fee: meltFee,
        destination: targetMintUrl,
      });

      let meltEffectiveFee: number | undefined;
      try {
        const meltResult = await this.paymentOperator.executeMelt(
          meltOp.operationId
        );
        meltEffectiveFee = meltResult?.effectiveFee;
      } catch (error) {
        try {
          await this.paymentOperator.rollbackMelt(
            meltOp.operationId,
            "melt failed"
          );
        } catch {
          /* ignore */
        }
        await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {});
        throw error;
      }

      await this.routeStore.deletePendingMelt(meltOp.quoteId).catch(() => {});

      try {
        await this.paymentOperator.redeemMintQuote(
          targetMintUrl,
          mintQuote.quote,
          selection.amount
        );
      } catch (error) {
        if (!isAlreadyRedeemedQuote(error)) {
          throw error;
        }
      }

      this.paymentOperator.unmarkMintQuoteAsSwap(mintQuote.quote);

      // The melt already settled, so its actual fee is known here — thread it
      // into the token-send leg so the ONE persisted transaction carries the
      // full cross-mint cost, not just the second leg.
      const actualMeltFee =
        (meltEffectiveFee ?? meltOp.feeReserve) + meltOp.swapFee;
      const tokenResult = await this.executeTokenSendWithProofRecovery(
        targetMintUrl,
        mintQuote.quote,
        selection,
        context,
        actualMeltFee
      );
      return {
        ...tokenResult,
        sourceMintUrl,
        targetMintUrl,
        fee: actualMeltFee + tokenResult.fee,
        ...(meltEffectiveFee != null && {
          effectiveFee: actualMeltFee + tokenResult.fee,
        }),
      };
    } catch (error) {
      if (mintQuote)
        this.paymentOperator.unmarkMintQuoteAsSwap(mintQuote.quote);
      throw error;
    }
  }

  private async executeTokenSendWithProofRecovery(
    mintUrl: string,
    quoteId: string,
    selection: RouteSelection,
    context: RouteContext,
    upstreamFee = 0,
  ): Promise<RouteExecutionResult> {
    try {
      return await this.executeTokenSendFlow(mintUrl, selection, context, upstreamFee)
    } catch (error) {
      const msg = String(error).toLowerCase()
      if (!msg.includes('insufficient') && !msg.includes('proof')) throw error

      await this.paymentOperator.mintAndReceive(quoteId, mintUrl, selection.amount)
      return await this.executeTokenSendFlow(mintUrl, selection, context, upstreamFee)
    }
  }

  private async executeTokenSendFlow(
    mintUrl: string,
    selection: RouteSelection,
    context: RouteContext,
    // Cross-mint routes pay a melt fee before this leg — persist the sum so
    // the archive shows what the send actually cost.
    upstreamFee = 0
  ): Promise<RouteExecutionResult> {
    let operationId: string | undefined;
    let txId: string | undefined;

    try {
      const prepared = await this.paymentOperator.prepareTokenSend({
        mintUrl,
        amount: selection.amount,
      });
      operationId = prepared.operationId;

      const { token } = await this.paymentOperator.executeTokenSend(
        prepared.operationId,
        {
          memo: context.memo,
        }
      );

      txId = `tx-ecash-send-${crypto.randomUUID()}`;
      const isRequestPayment = context.parsedCreq != null;
      await this.txRepo.save(
        createTransaction({
          id: txId,
          direction: "send",
          method: "cashu:ecash",
          protocol: "cashu-token",
          amount: sat(selection.amount),
          accountId: mintUrl,
          memo: context.memo,
          outcome: "unclaimed",
          ...(isRequestPayment && { intent: "request-pay" as const }),
          ...(prepared.fee != null && { fee: { quoted: sat(prepared.fee + upstreamFee) } }),
          metadata: {
            route: selection.route,
            token,
            tokenState: "unspent",
            operationId: prepared.operationId,
            ...(isRequestPayment && { intent: "request-pay" }),
            ...(prepared.fee != null && { fee: prepared.fee + upstreamFee }),
          },
        })
      );

      await this.routeStore.savePendingSendToken({
        id: txId,
        token,
        mintUrl,
        amount: selection.amount,
        operationId: prepared.operationId,
      });

      const deliveryResult = await this.delivery.deliverToken({
        token,
        parsedRequest: context.parsedCreq,
        memo: context.memo,
      });

      // Delivery reports failure by return value, not by throwing. Raising it
      // here is what routes an undeliverable send into the compensating catch —
      // otherwise the funds stay committed behind a phantom unclaimed token.
      if (!deliveryResult.success) {
        throw new PaymentDeliveryFailedError();
      }

      this.notifyChanged(mintUrl);

      return {
        status: "settled",
        amount: selection.amount,
        fee: prepared.fee,
        sourceMintUrl: mintUrl,
        transactionId: txId,
        token,
        transportUsed: deliveryResult.transportUsed,
      };
    } catch (error) {
      await this.compensateTokenSend(mintUrl, operationId, txId);
      throw error;
    }
  }

  /**
   * Undoes a token send that never reached its recipient.
   *
   * The artifacts are only erased once the funds are provably back: if the
   * rollback fails they are the user's sole path to a manual reclaim, so they
   * must survive.
   */
  private async compensateTokenSend(
    mintUrl: string,
    operationId: string | undefined,
    txId: string | undefined
  ): Promise<void> {
    if (!operationId) return;

    try {
      await this.paymentOperator.rollbackTokenSend(operationId);
    } catch {
      return;
    }

    if (txId) {
      try {
        await this.routeStore.deletePendingSendToken(txId);
      } catch {
        /* ignore */
      }
      try {
        await this.txRepo.delete(txId);
      } catch {
        /* ignore */
      }
    }

    this.notifyChanged(mintUrl);
  }

  private async resolveInvoiceValue(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<string | null> {
    if (selection.invoice) return selection.invoice;

    if (context.lnurlPayParams) {
      const result = await this.lnurl.fetchInvoice(
        context.lnurlPayParams,
        selection.amount
      );
      return result.bolt11 ?? null;
    }

    const addressOrInvoice = context.addressOrInvoice;
    if (!addressOrInvoice) return null;

    if (this.tokenCodec.isBolt11(addressOrInvoice)) {
      const decoded = this.tokenCodec.decodeBolt11(addressOrInvoice);
      return decoded.isExpired ? null : addressOrInvoice;
    }

    if (this.tokenCodec.isLightningAddress(addressOrInvoice)) {
      const params = await this.lnurl.resolvePay(addressOrInvoice);
      const result = await this.lnurl.fetchInvoice(params, selection.amount);
      return result.bolt11 ?? null;
    }

    return addressOrInvoice;
  }

  private notifyChanged(accountId: string): void {
    this.eventBus.emit({
      type: "balance:changed",
      payload: { moduleId: "cashu", accountId },
    });
    this.eventBus.emit({
      type: "transactions:changed",
      payload: { reason: "route-executed" },
    });
    this.syncNotifier?.notifyBalanceChanged();
  }
}

function isAlreadyRedeemedQuote(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("already pending") ||
    message.includes("already issued") ||
    message.includes("already redeemed")
  );
}

function toBaseError(error: unknown): BaseError {
  if (error instanceof BaseError) return error;
  return new UnknownError(
    error instanceof Error ? error.message : String(error),
    error
  );
}
