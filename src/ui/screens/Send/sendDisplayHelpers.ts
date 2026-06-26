import type { SendableValidatedData } from "./SendFlow";

export function getDestinationDisplay(
  data: SendableValidatedData,
  displayName?: string
): string {
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
