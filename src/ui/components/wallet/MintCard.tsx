import { useState } from "react";
import type { MintInfo } from "@/core/types";
import { cn } from "@/lib/utils";
import cardLogo from "@/assets/card-logo.svg";
import cardBg from "@/assets/card-bg.png";
import cardNoise from "@/assets/card-noise.png";

export type MintCardVariant = "light" | "medium" | "dark" | "darker";
export type MintCardSize = "sm" | "md";

interface MintCardProps {
  mint: MintInfo;
  variant?: MintCardVariant;
  size?: MintCardSize;
  isSelected?: boolean;
  hideBalance?: boolean;
  onClick?: () => void;
  onCreateToken?: () => void;
}

/**
 * Mint logo component with fallback to default card logo
 */
function MintLogo({
  iconUrl,
  size = "md"
}: {
  iconUrl?: string;
  size?: "sm" | "md"
}) {
  const [hasError, setHasError] = useState(false);

  const sizeClasses = size === "sm"
    ? "w-5 h-5 sm:w-6 sm:h-6"
    : "w-6 h-6";

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

// Small card gradient config (kept for SendScreen carousel)
const smGradientConfig = {
  light: { from: "#e8a87c", to: "#d4735e" },
  medium: { from: "#d4a574", to: "#c47d5c" },
  dark: { from: "#c98e6e", to: "#b86b4f" },
  darker: { from: "#d9b08c", to: "#c88a6a" },
} as const;

export function MintCard({
  mint,
  variant = "medium",
  size = "md",
  isSelected,
  hideBalance,
  onClick,
  onCreateToken,
}: MintCardProps) {
  const displayName = getMintShortName(mint.url, mint.name);

  // Small card variant (for carousel in SendScreen)
  if (size === "sm") {
    const config = smGradientConfig[variant];
    return (
      <div
        onClick={onClick}
        className={cn(
          "relative rounded-sm overflow-hidden cursor-pointer transition-all shadow-lg border border-white/5 clip-rounded-3xl active:scale-[0.95] touch-manipulation",
          isSelected === true && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          isSelected === false && "opacity-50 scale-[0.92]",
          "h-[18vh] max-h-[140px] min-w-[105px] w-[33vw] max-w-[120px]"
        )}
      >
        {/* Gradient Background */}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(155deg, ${config.from} 0%, ${config.to} 100%)` }}
        />

        {/* Online status dot - bottom right */}
        <div
          role="status"
          aria-label={mint.isOnline ? 'Online' : 'Offline'}
          className={cn(
            "absolute bottom-2 right-2 z-20 w-[6px] h-[6px] rounded-full border border-white/30",
            mint.isOnline
              ? "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]"
              : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)]"
          )}
        />

        {/* Content */}
        <div className="relative z-10 h-full p-2.5 flex flex-col justify-between">
          {/* Header: Logo & Name */}
          <div className="flex justify-between items-start">
            <MintLogo iconUrl={mint.iconUrl} size="sm" />
            <div className="font-['Montserrat'] font-bold text-[9px] leading-tight tracking-wide text-white drop-shadow-lg text-right max-w-[50%] flex flex-col items-end">
              {displayName.split(/[\s-]+/).slice(0, 2).map((word, i) => (
                <span key={i}>{word}</span>
              ))}
            </div>
          </div>

          {/* Balance - Bottom Left */}
          {!hideBalance && (
            <div className="flex flex-col">
              <span className="text-[6px] font-bold uppercase tracking-[0.15em] text-white/60">
                Balance
              </span>
              <span className="font-['Montserrat'] text-xs font-bold text-white tracking-tight drop-shadow-md">
                <span className="text-[#b6b6b6]">₿</span>{mint.balance.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Medium card variant (for Home screen carousel)
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative w-[var(--card-w)] aspect-[280/176] rounded-[13px] overflow-hidden cursor-pointer active:scale-[0.98] transition-transform touch-manipulation",
        "border-[1.3px] border-solid border-[rgba(250,250,250,0.8)]",
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
        style={{ inset: '-1.3px', width: 'calc(100% + 2.6px)', height: 'calc(100% + 2.6px)', filter: variantFilters[variant] }}
      />

      {/* Noise texture */}
      <div
        aria-hidden="true"
        className="absolute opacity-5 pointer-events-none"
        style={{ inset: '-1.3px', backgroundImage: `url('${cardNoise}')`, backgroundSize: '200% 200%', backgroundPosition: 'top left' }}
      />

      {/* Mint Name */}
      <p
        className="absolute z-10 font-['Montserrat'] font-bold text-[15.6px] text-[#fafafa] uppercase leading-normal whitespace-nowrap"
        style={{ top: '13%', left: '9.3%' }}
      >
        {displayName}
      </p>

      {/* Mint Logo — top-right */}
      <div
        className="absolute z-10 bg-white rounded-full flex items-center justify-center overflow-hidden"
        style={{ right: '5.7%', top: '11.4%', width: '25px', height: '25px', boxShadow: '6.5px 0px 2.6px 0px rgba(0,0,0,0.34)' }}
      >
        <MintLogo iconUrl={mint.iconUrl} size="sm" />
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
            <span className="text-[#817a7a]">₿</span>
            {` ${mint.balance.toLocaleString()}`}
          </p>
        </>
      )}

      {/* Create Token button */}
      {onCreateToken && (
        <button
          onClick={(e) => { e.stopPropagation(); onCreateToken(); }}
          className="absolute z-20 bg-[rgba(224,188,188,0.76)] border border-[#d6baba] rounded-[8px] px-3 py-1.5 font-['Outfit'] font-semibold text-[10px] text-white hover:bg-[rgba(224,188,188,0.9)] active:scale-95 transition-all"
          style={{ right: '5%', top: '74%' }}
        >
          토큰 생성하기
        </button>
      )}
    </div>
  );
}
