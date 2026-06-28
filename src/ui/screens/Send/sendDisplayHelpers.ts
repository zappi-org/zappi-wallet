import type { SendableValidatedData } from "./SendFlow";
import { PaymentRoute } from "@/ui/hooks/use-routing";

type Translate = (key: string) => string;

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
        recipient: displayName || data.address,
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
        recipient: displayName || t("send.confirm.ecashRequest"),
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
  if (
    isLightningRoute(options?.route) &&
    data.type === "cashu-request" &&
    data.parsed.lightningInvoice
  ) {
    return options?.t?.("send.confirm.lightningInvoice") || "Lightning";
  }

  if (displayName) return displayName;
  switch (data.type) {
    case "bolt11":
      return "Lightning";
    case "lightning-address":
      return data.address.includes("@")
        ? data.address.split("@")[0]
        : data.address;
    case "lnurl-pay":
      return data.params?.domain || "LNURL";
    case "cashu-request":
      return "eCash";
    case "my-wallet":
      return data.targetMintName;
  }
}

/**
 * Format npub for display: first8...mid4...last4
 */
export function formatNpubShort(npub: string): string {
  if (npub.length < 20) return npub;
  const mid = Math.floor(npub.length / 2);
  return `${npub.slice(0, 8)}...${npub.slice(mid - 2, mid + 2)}...${npub.slice(
    -4
  )}`;
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
