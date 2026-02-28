import { useState } from "react";
import type { MintInfo } from "@/core/types";
import { cn } from "@/lib/utils";
import cardLogo from "@/assets/card-logo.svg";

export type MintCardVariant = "light" | "medium" | "dark" | "darker";
export type MintCardSize = "sm" | "md";

interface MintCardProps {
  mint: MintInfo;
  variant?: MintCardVariant;
  size?: MintCardSize;
  isSelected?: boolean;
  hideBalance?: boolean;
  onClick?: () => void;
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

// Card gradient config - navy palette
const gradientConfig = {
  light: { from: "#526074", to: "#3a4a5c" },
  medium: { from: "#3a4a5c", to: "#18202d" },
  dark: { from: "#2c3a4a", to: "#0f1520" },
  darker: { from: "#526074", to: "#18202d" },
} as const;

export function MintCard({
  mint,
  variant = "medium",
  size = "md",
  isSelected,
  hideBalance,
  onClick,
}: MintCardProps) {
  const displayName = getMintShortName(mint.url, mint.name);

  // Small card variant (for carousel in SendScreen)
  if (size === "sm") {
    const config = gradientConfig[variant];
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
            <div className="font-bold text-[9px] leading-tight tracking-wide text-white drop-shadow-lg text-right max-w-[50%] flex flex-col items-end">
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
              <span className="text-xs font-bold text-white tracking-tight drop-shadow-md">
                ₿{mint.balance.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Medium card variant (for Home screen carousel) - New design
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative w-72 h-44 bg-gradient-to-r from-[#526074] to-[#18202d] rounded-[16px] p-5 text-white shadow-xl shrink-0 flex flex-col justify-between overflow-hidden cursor-pointer active:scale-[0.98] transition-transform touch-manipulation",
        isSelected === true && "ring-2 ring-primary ring-offset-3 ring-offset-background",
        isSelected === false && "opacity-70"
      )}
    >
      {/* Vertical Text - Cashu */}
      <div className="absolute top-0 bottom-0 left-2 flex items-center pointer-events-none">
        <div className="transform -rotate-90 origin-center text-5xl font-bold text-white/10 tracking-widest whitespace-nowrap">CASHU</div>
      </div>

      {/* Online status dot - top right */}
      <div
        role="status"
        aria-label={mint.isOnline ? 'Online' : 'Offline'}
        className={cn(
          "absolute top-3 right-3 z-20 w-[8px] h-[8px] rounded-full border border-white/30",
          mint.isOnline
            ? "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]"
            : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)]"
        )}
      />

      {/* Card Content */}
      <div className="flex justify-between items-end z-10 h-full w-full">
        {/* Bottom Left: Balance */}
        {!hideBalance && (
          <div className="flex flex-col">
            <span className="text-xs text-gray-400 font-bold tracking-wider mb-1">BALANCE</span>
            <div className="text-2xl font-bold flex items-center gap-1">
              <span>₿</span>
              <span>{mint.balance.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Bottom Right: Mint Logo */}
        <div className="bg-white/10 p-2 rounded-full backdrop-blur-sm mb-1">
          <MintLogo iconUrl={mint.iconUrl} size="md" />
        </div>
      </div>
    </div>
  );
}
