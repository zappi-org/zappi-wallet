import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MintInfo } from "@/core/types";
import { cn } from "@/lib/utils";
import { useFormatSats } from "@/utils/format";
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
      className={cn(sizeClasses, "object-contain rounded-sm")}
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
  onCreateToken,
}: MintCardProps) {
  const { t } = useTranslation();
  const formatSats = useFormatSats();
  const displayName = getMintShortName(mint.url, mint.name);
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative w-[var(--card-w)] aspect-[280/176] rounded-[13px] overflow-hidden cursor-pointer transition-transform touch-manipulation [&:active:not(:has(:active))]:scale-[0.98]",
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
        className="absolute z-10 flex items-center gap-2"
        style={{ top: '13%', left: '9.3%' }}
      >
        <div
          className="rounded-full flex items-center justify-center overflow-hidden shrink-0"
          style={{ width: '25px', height: '25px' }}
        >
          <MintLogo iconUrl={mint.iconUrl} />
        </div>
        <p className="font-['Montserrat'] font-bold text-[15.6px] text-[#fafafa] uppercase leading-normal whitespace-nowrap">
          {displayName}
        </p>
      </div>

      {/* BALANCE label & amount */}
      {!hideBalance && (
        <>
          <p
            className="absolute z-10 font-['Montserrat'] font-semibold text-[13px] text-white leading-normal whitespace-nowrap"
            style={{ top: '71%', left: '9.3%' }}
          >
            BALANCE
          </p>
          <p
            className="absolute z-10 font-['Montserrat'] font-semibold text-[15.6px] text-[#fafafa] leading-normal"
            style={{ top: '80%', left: '9.3%' }}
          >
            {formatSats(mint.balance)}
          </p>
        </>
      )}

      {/* Create Token button */}
      {onCreateToken && (
        <button
          onClick={(e) => { e.stopPropagation(); onCreateToken(); }}
          disabled={mint.balance === 0}
          className="absolute z-20 bg-[#c49a9a] border border-[#b88a8a] rounded-[8px] px-4 py-2 font-['Outfit'] font-semibold text-[13px] text-white hover:bg-[#d4a8a8] active:scale-90 active:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ right: '5%', top: '74%' }}
        >
          {t('payment.createToken')}
        </button>
      )}
    </div>
  );
}
