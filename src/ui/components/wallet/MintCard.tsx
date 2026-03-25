import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EllipsisVertical } from "lucide-react";
import type { MintInfo } from "@/core/types";
import { cn } from "@/lib/utils";
import { useFormatSats, useFormatFiat } from "@/utils/format";
import cardLogo from "@/assets/card-logo.svg";
import cardBg from "@/assets/card-bg.png";
import cardNoise from "@/assets/card-noise.png";

export type MintCardVariant = "light" | "medium" | "dark" | "darker";

interface MintCardProps {
  mint: MintInfo;
  variant?: MintCardVariant;
  isSelected?: boolean;
  hideBalance?: boolean;
  onClick?: () => void;
  onDetail?: () => void;
  onCreateToken?: () => void;
}

/**
 * Mint logo component with fallback to default card logo
 */
function MintLogo({ iconUrl }: { iconUrl?: string }) {
  const [hasError, setHasError] = useState(false);

  const sizeClasses = "w-6 h-6";

  // Use default card logo if no iconUrl or load error
  if (!iconUrl || hasError) {
    return (
      <img
        src={cardLogo}
        alt="Card Logo"
        className={cn(sizeClasses, "object-contain drop-shadow-sm")}
      />
    );
  }

  return (
    <img
      src={iconUrl}
      alt="Mint Logo"
      className={cn(sizeClasses, "object-contain rounded")}
      onError={() => setHasError(true)}
    />
  );
}

// Get variant based on index (for automatic color assignment)
// eslint-disable-next-line react-refresh/only-export-components
export function getVariantByIndex(index: number): MintCardVariant {
  const variants: MintCardVariant[] = ["darker", "medium", "light", "dark"];
  return variants[index % variants.length];
}

// Extract short name from mint URL
function getMintShortName(url: string, name?: string): string {
  if (name) return name;
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^(www\.|mint\.|api\.)/, "")
      .replace(/\.(com|io|org|net)$/, "")
      .split(".")[0]
      .slice(0, 12);
  } catch {
    return url.slice(0, 12);
  }
}

// Warm-tone card variant filters (hue-rotate + brightness to create variety from single bg image)
const variantFilters = {
  darker: "none",
  light: "hue-rotate(15deg) brightness(1.05)",
  medium: "hue-rotate(-15deg) brightness(0.92)",
  dark: "hue-rotate(-30deg) brightness(0.82)",
} as const;

export function MintCard({
  mint,
  variant = "medium",
  isSelected,
  hideBalance,
  onClick,
  onDetail,
  onCreateToken,
}: MintCardProps) {
  const { t } = useTranslation();
  const formatSats = useFormatSats();
  const toFiat = useFormatFiat();
  const displayName = mint.alias || getMintShortName(mint.url, mint.name);
  const showMintSubName = !!mint.alias && !!mint.mintName;
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative w-[var(--card-w)] aspect-[280/176] rounded-[13px] overflow-hidden transition-transform touch-manipulation",
        onClick && "cursor-pointer [&:active:not(:has(:active))]:scale-[0.98]",
        "shadow-[0px_4px_4px_0px_rgba(0,0,0,0.2)]",
        isSelected === true && "ring-2 ring-primary ring-offset-3 ring-offset-background",
        isSelected === false && "opacity-70"
      )}
    >
      {/* Background — extends under border */}
      <img
        alt=""
        className="absolute max-w-none object-cover pointer-events-none"
        src={cardBg}
        style={{ inset: 0, width: '100%', height: '100%', filter: variantFilters[variant] }}
      />

      {/* Noise texture */}
      <div
        aria-hidden="true"
        className="absolute opacity-5 pointer-events-none"
        style={{ inset: 0, backgroundImage: `url('${cardNoise}')`, backgroundSize: '200% 200%', backgroundPosition: 'top left' }}
      />

      {/* Mint Logo + Name — top-left */}
      <div
        className="absolute z-10 flex items-start gap-2"
        style={{ top: '13%', left: '9.3%' }}
      >
        <div
          className="rounded-full flex items-center justify-center overflow-hidden shrink-0 h-[27px]"
          style={{ width: '25px', minHeight: '25px' }}
        >
          <MintLogo iconUrl={mint.iconUrl} />
        </div>
        <div className="flex flex-col">
          <p className="font-display text-amount text-white leading-[27px] whitespace-nowrap">
            {displayName}
          </p>
          {showMintSubName && (
            <p className="font-display text-overline text-white/60 leading-tight whitespace-nowrap">
              {mint.mintName}
            </p>
          )}
        </div>
      </div>

      {/* Detail button — top-right */}
      {onDetail && (
        <button
          onClick={(e) => { e.stopPropagation(); onDetail(); }}
          className="absolute z-20 w-11 h-11 flex items-center justify-center rounded-full active:bg-white/10 transition-colors"
          style={{ top: '10%', right: '4%' }}
        >
          <EllipsisVertical className="w-5 h-5 text-white/80" />
        </button>
      )}

      {/* BALANCE label & amount */}
      {!hideBalance && (
        <div
          className="absolute z-10 flex flex-col gap-0.5"
          style={{ bottom: '8%', left: '9.3%' }}
        >
          <p className="font-display text-caption font-semibold text-white leading-normal whitespace-nowrap">
            Balance
          </p>
          <p className="font-display text-body-bold text-white leading-normal">
            {formatSats(mint.balance)}
          </p>
          {(() => {
            const fiatStr = toFiat(mint.balance)
            return fiatStr ? (
              <span className="font-display text-overline text-white/60 leading-normal">
                {fiatStr}
              </span>
            ) : null
          })()}
        </div>
      )}

      {/* Create Token button */}
      {onCreateToken && (
        <button
          onClick={(e) => { e.stopPropagation(); onCreateToken(); }}
          disabled={mint.balance === 0}
          className="absolute z-20 bg-white/20 border border-white/10 rounded-lg px-4 py-2 text-caption font-semibold text-white hover:bg-white/30 active:scale-95 active:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ right: '5%', top: '74%' }}
        >
          {t('payment.createToken')}
        </button>
      )}
    </div>
  );
}
