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
    : "w-8 h-8";

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

// Card gradient config - simple 2-color gradients matching design
const gradientConfig = {
  light: { from: "#7BA873", to: "#5B8A50", dark: "#1a2e22" },
  medium: { from: "#5B8A50", to: "#3D5E3A", dark: "#1a2e22" },
  dark: { from: "#6B5B4E", to: "#3E3229", dark: "#2A2118" },
  darker: { from: "#3D5E3A", to: "#1a2e22", dark: "#0d1a12" },
} as const;

function ArtBackground({ variant }: { variant: MintCardVariant }) {
  const config = gradientConfig[variant];
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(155deg, ${config.from} 0%, ${config.to} 100%)` }}
    />
  );
}

// Bottom gradient fade for balance area
function BottomFade({ variant }: { variant: MintCardVariant }) {
  const dark = gradientConfig[variant].dark;
  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-[60px] pointer-events-none"
      style={{ background: `linear-gradient(to bottom, transparent 0%, ${dark}ee 50%, ${dark} 100%)` }}
    />
  );
}

export function MintCard({
  mint,
  variant = "medium",
  size = "md",
  isSelected,
  hideBalance,
  onClick,
}: MintCardProps) {
  const displayName = getMintShortName(mint.url, mint.name);

  // Noise texture overlay
  const noiseImage = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E")`;

  // Small card variant (for carousel in SendScreen) - Same ratio as medium, just smaller
  if (size === "sm") {
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
        {/* Full Art Background */}
        <div className="absolute inset-0">
          <ArtBackground variant={variant} />
        </div>

        {/* Noise Texture */}
        <div
          className="absolute inset-0 mix-blend-overlay opacity-20 pointer-events-none"
          style={{ backgroundImage: noiseImage }}
        />

        {/* Subtle Glass Reflection */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-50 pointer-events-none" />

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
            {/* Name - Top Right (one word per line) */}
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

  // Medium card variant (for Home screen carousel) - Unified card design
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative w-full aspect-[220/245] rounded-[20px] overflow-hidden cursor-pointer shadow-[0_6px_20px_rgba(61,94,58,0.13)] transition-all duration-500 group clip-rounded-3xl active:scale-[0.98] touch-manipulation",
        isSelected === true && "ring-2 ring-primary ring-offset-3 ring-offset-background",
        isSelected === false && "opacity-70"
      )}
    >
      {/* Art Background */}
      <ArtBackground variant={variant} />

      {/* Noise Texture */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-20 pointer-events-none"
        style={{ backgroundImage: noiseImage }}
      />

      {/* Bottom gradient fade for balance area */}
      <BottomFade variant={variant} />

      {/* Online status dot - bottom right of card */}
      <div
        role="status"
        aria-label={mint.isOnline ? 'Online' : 'Offline'}
        className={cn(
          "absolute bottom-3 right-3 z-20 w-[8px] h-[8px] rounded-full border border-white/30",
          mint.isOnline
            ? "bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]"
            : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)]"
        )}
      />

      {/* Content */}
      <div className="relative z-10 h-full p-4 flex flex-col justify-between">
        {/* Header: Logo + Name */}
        <div className="flex items-center gap-2">
          <MintLogo iconUrl={mint.iconUrl} size="md" />
          <span className="font-bold text-[15px] tracking-wide text-white">
            {displayName}
          </span>
        </div>

        {/* Balance - Bottom Left */}
        {!hideBalance && (
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/55">
              Balance
            </span>
            <span className="text-[22px] font-bold text-white tracking-tight leading-tight">
              ₿{mint.balance.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
