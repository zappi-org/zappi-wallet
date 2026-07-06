import type { TFunction } from "i18next";
import type { SendableValidatedData } from "./SendFlow";
import { isNostrDirectAddress } from "@/core/domain/nostr-address";
import { PaymentRoute } from "@/ui/hooks/use-routing";

type Translate = TFunction;
type CashuRequestSendData = Extract<SendableValidatedData, { type: "cashu-request" }>;

export interface ConfirmDisplayInfo {
  method: string;
  recipient: string;
  recipientDetail: string;
  memo?: string;
}

function isLightningRoute(route: PaymentRoute | undefined): boolean {
  return (
    route === PaymentRoute.LN_INTERNAL ||
    route === PaymentRoute.LN_CROSS_MINT ||
    route === PaymentRoute.MELT_TO_LN
  );
}

export function formatNpubShort(npub: string): string {
  const trimmed = npub.trim();
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

export function formatRecipientDisplayText(value: string, maxLength = 12): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (isNostrDirectAddress(trimmed)) return formatNpubShort(trimmed);
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function isCashuRequestData(data: SendableValidatedData): data is CashuRequestSendData {
  return data.type === "cashu-request";
}

export function isDirectCashuRecipient(data: SendableValidatedData): boolean {
  return (
    isCashuRequestData(data) &&
    data.parsed.sameMintOnly === true &&
    !!data.parsed.nostrTarget &&
    isNostrDirectAddress(data.request)
  );
}

export function shouldShowRecipientInMainMessage(data: SendableValidatedData): boolean {
  if (data.type === "bolt11" || data.type === "lnurl-pay") return false;
  if (data.type === "cashu-request") return isDirectCashuRecipient(data);
  return true;
}

export function getConfirmDisplayInfo(
  data: SendableValidatedData,
  route: PaymentRoute | undefined,
  t: Translate,
  displayName?: string
): ConfirmDisplayInfo {
  // Route-aware: unified QR에서 LN 라우트가 선택되면 lightning invoice 기반 표시
  const isLnRoute = isLightningRoute(route);
  const isTokenRoute =
    route === PaymentRoute.TOKEN_TRANSFER ||
    route === PaymentRoute.OWN_MINT_TOKEN ||
    route === PaymentRoute.MINT_AND_DM;

  if (isCashuRequestData(data) && isDirectCashuRecipient(data)) {
    return {
      method: "eCash",
      recipient: formatRecipientDisplayText(displayName || data.request),
      recipientDetail: displayName ? formatNpubShort(data.request) : "",
      memo: data.parsed.description,
    };
  }

  if (
    isLnRoute &&
    data.type === "cashu-request" &&
    data.parsed.lightningInvoice
  ) {
    const inv = data.parsed.lightningInvoice;
    return {
      method: "Lightning",
      recipient: t("send.confirm.lightningInvoice"),
      recipientDetail: `${inv.slice(0, 12).toLowerCase()}...${inv
        .slice(-4)
        .toLowerCase()}`,
      memo: data.parsed.description,
    };
  }

  if (isTokenRoute && data.type === "cashu-request") {
    const req = data.request;
    return {
      method: "eCash",
      recipient: t("send.confirm.ecashRequest"),
      recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
      memo: data.parsed.description,
    };
  }

  // For cashu-request, infer the most likely method from the data alone when
  // the route hasn't been computed yet. Without this, the confirm screen would
  // flash "eCash" before the async route selection completes, even though the
  // route may end up being a Lightning route.
  if (!route && data.type === "cashu-request") {
    if (data.parsed.lightningInvoice) {
      const inv = data.parsed.lightningInvoice;
      return {
        method: "Lightning",
        recipient: t("send.confirm.lightningInvoice"),
        recipientDetail: `${inv.slice(0, 12).toLowerCase()}...${inv
          .slice(-4)
          .toLowerCase()}`,
        memo: data.parsed.description,
      };
    }
    const req = data.request;
    return {
      method: "eCash",
      recipient: displayName || t("send.confirm.ecashRequest"),
      recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
      memo: data.parsed.description,
    };
  }

  switch (data.type) {
    case "bolt11": {
      const inv = data.invoice;
      return {
        method: "Lightning",
        recipient: t("send.confirm.lightningInvoice"),
        recipientDetail: `${inv.slice(0, 8)}...${inv.slice(-4)}`,
        memo: data.description || undefined,
      };
    }
    case "lightning-address":
      return {
        method: "Lightning",
        recipient: formatRecipientDisplayText(displayName || data.address),
        recipientDetail: data.address,
      };
    case "lnurl-pay":
      return {
        method: "Lightning",
        recipient: data.params?.domain || "LNURL",
        recipientDetail: data.params?.domain || "LNURL",
      };
    case "cashu-request": {
      // fallback (route 없을 때)
      const req = data.request;
      return {
        method: "eCash",
        recipient: t("send.confirm.ecashRequest"),
        recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
        memo: data.parsed.description,
      };
    }
    case "my-wallet":
      return {
        method: t("send.confirm.internalTransfer"),
        recipient: data.targetMintName,
        recipientDetail: `${data.targetMintUrl.slice(0, 20)}...`,
      };
  }
}

export function getDestinationDisplay(
  data: SendableValidatedData,
  displayName?: string,
  options?: {
    route?: PaymentRoute;
    t?: Translate;
  }
): string {
  if (isCashuRequestData(data) && isDirectCashuRecipient(data)) {
    return formatRecipientDisplayText(displayName || data.request);
  }

  if (
    isLightningRoute(options?.route) &&
    data.type === "cashu-request" &&
    data.parsed.lightningInvoice
  ) {
    return options?.t?.("send.confirm.lightningInvoice") || "Lightning";
  }

  if (displayName) return formatRecipientDisplayText(displayName);
  switch (data.type) {
    case "bolt11":
      return "Lightning";
    case "lightning-address":
      return formatRecipientDisplayText(data.address.includes("@")
        ? data.address.split("@")[0]
        : data.address);
    case "lnurl-pay":
      return data.params?.domain || "LNURL";
    case "cashu-request":
      return "eCash";
    case "my-wallet":
      return formatRecipientDisplayText(data.targetMintName);
  }
}

/**
 * Look up contact name by address
 * @param findByAddress - ContactUseCase.findByAddress 또는 동등한 함수
 */
export async function findContactName(
  address: string,
  findByAddress: (addr: string) => Promise<{ name: string } | null>
): Promise<string | null> {
  const contact = await findByAddress(address);
  return contact?.name || null;
}
