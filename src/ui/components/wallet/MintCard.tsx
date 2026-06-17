import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { MintInfo } from "@/core/types";
import { cn } from "@/ui/lib/utils";
import { useFormatSats, useFormatFiat } from "@/utils/format";
import { hapticTap } from "@/ui/utils/haptic";
import { useAppStore } from "@/store";
import { LIMITS } from "@/core/constants";
import cardLogo from "@/assets/card-logo.svg";
import cardBg from "@/assets/card-bg.png";
import cardNoise from "@/assets/card-noise.png";
import zappiLogo from "@/assets/zappi.png";

export type MintCardVariant =
  | "light" | "medium" | "dark" | "darker"
  | "indigo" | "lime" | "sky" | "peach"
  | "coral" | "teal" | "slate" | "amber" | "plum" | "forest";

interface MintCardProps {
  mint: MintInfo;
  variant?: MintCardVariant;
  /** Custom hex color override (e.g. "#FF5500") */
  customColor?: string;
  isSelected?: boolean;
  hideBalance?: boolean;
  onClick?: () => void;
  onDetail?: () => void;
  onSend?: () => void;
  onReceive?: () => void;
  onRename?: (newName: string) => void;
  sendDisabled?: boolean;
}

function MintLogo({ iconUrl }: { iconUrl?: string }) {
  const [hasError, setHasError] = useState(false);
  const sizeClasses = "block w-[22px] h-[22px] shrink-0 rounded-full";

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
      className={cn(sizeClasses, "object-contain")}
      onError={() => setHasError(true)}
    />
  );
}

/** Preset variant names for color picker */
// eslint-disable-next-line react-refresh/only-export-components
export const CARD_PRESET_VARIANTS: MintCardVariant[] = [
  "teal",
  "indigo",
  "lime",
  "sky",
  "peach",
  "coral",
  "amber",
  "slate",
  "plum",
  "forest",
];

// eslint-disable-next-line react-refresh/only-export-components
export function getVariantByIndex(index: number): MintCardVariant {
  const safeIndex = index >= 0 ? index : 0;
  return CARD_PRESET_VARIANTS[safeIndex % CARD_PRESET_VARIANTS.length];
}

/** Hex colors for preset variants (single source of truth) */
// eslint-disable-next-line react-refresh/only-export-components
export const VARIANT_HEX: Record<string, string> = {
  light: '#8B91D9', medium: '#6B73CE', dark: '#515AC0', darker: '#3A4190',
  indigo: '#515AC0', lime: '#F1F6B6', sky: '#D2E1FF', peach: '#FFC5AB',
  coral: '#C75D4A', amber: '#B8863A',
  teal: '#3A9E8F', slate: '#5A6578', plum: '#8B5A8A', forest: '#4A7C5E',
};

/** Resolve mint color from settings: returns { variant, customColor } */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveMintColor(mintUrl: string, index: number, mintColors?: Record<string, string>): { variant: MintCardVariant; customColor?: string } {
  const saved = mintColors?.[mintUrl]
  if (!saved) return { variant: getVariantByIndex(index) }
  if (saved.startsWith('#')) return { variant: getVariantByIndex(index), customColor: saved }
  if (CARD_PRESET_VARIANTS.includes(saved as MintCardVariant)) return { variant: saved as MintCardVariant }
  return { variant: getVariantByIndex(index) }
}

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

const variantColorClass: Record<MintCardVariant, string> = {
  indigo: "bg-card-indigo",
  lime: "bg-card-lime",
  sky: "bg-card-sky",
  peach: "bg-card-peach",
  coral: "bg-card-coral",
  teal: "bg-card-teal",
  slate: "bg-card-slate",
  amber: "bg-card-amber",
  plum: "bg-card-plum",
  forest: "bg-card-forest",
  light: "bg-card-gradient-light",
  medium: "bg-card-gradient-medium",
  dark: "bg-card-gradient-dark",
  darker: "bg-card-gradient-darker",
};

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;

  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

function shouldUseDarkInk(hex: string): boolean {
  const luminance = getRelativeLuminance(hex);
  if (luminance === null) return false;

  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast > whiteContrast;
}

export function MintCard({
  mint,
  variant = "medium",
  customColor,
  isSelected,
  hideBalance,
  onClick,
  onDetail,
  onSend,
  onReceive,
  onRename,
  sendDisabled,
}: MintCardProps) {
  const { t } = useTranslation();
  const formatSats = useFormatSats();
  const toFiat = useFormatFiat();
  const cardDesignPreset = useAppStore((s) => s.settings.mintCardDesignPresets?.[mint.url] ?? "modern");
  const isClassicDesign = cardDesignPreset !== "modern";
  const displayName = mint.alias || getMintShortName(mint.url, mint.name);
  const surfaceStyle = customColor ? { backgroundColor: customColor } : undefined;
  const cardBaseColor = customColor ?? VARIANT_HEX[variant] ?? VARIANT_HEX.medium;
  const useDarkInk = shouldUseDarkInk(cardBaseColor);
  const primaryInk = useDarkInk ? "text-foreground" : "text-white";
  const strongInk = useDarkInk ? "text-foreground/90" : "text-white/80";
  const mutedInk = useDarkInk ? "text-foreground/55" : "text-white/50";
  const subtleInk = useDarkInk ? "text-foreground/45" : "text-white/45";
  const hairlineClass = useDarkInk ? "bg-foreground/10" : "bg-white/10";
  const footerSurfaceClass = useDarkInk ? "bg-foreground/5" : "bg-black/10";
  const actionActiveClass = useDarkInk ? "active:bg-foreground/10" : "active:bg-white/10";
  const inputToneClass = useDarkInk
    ? "text-foreground bg-white/35 ring-1 ring-foreground/10"
    : "text-white bg-white/15";
  const classicTextureStyle = customColor
    ? {
        opacity: 0.42,
        mixBlendMode: "multiply" as const,
      }
    : {
        opacity: 0.36,
        mixBlendMode: "multiply" as const,
      };

  // Inline rename state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayName) {
      onRename?.(trimmed);
    }
    setIsEditing(false);
  }, [editValue, displayName, onRename]);

  return (
    <div
      className={cn(
        "relative w-[var(--card-w)] rounded-card overflow-hidden touch-manipulation",
        "shadow-[0px_4px_8px_0px_rgba(0,0,0,0.15)]",
        isClassicDesign && !customColor && variantColorClass[variant],
        isSelected === true && "ring-2 ring-primary ring-offset-3 ring-offset-background",
        isSelected === false && "opacity-70"
      )}
      style={isClassicDesign ? surfaceStyle : undefined}
    >
      {isClassicDesign && (
        <>
          {/* Legacy card background — kept below the body and footer so the card shape/actions stay current. */}
          <img
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            src={cardBg}
            style={classicTextureStyle}
          />

          {/* Noise texture */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-5 pointer-events-none"
            style={{ backgroundImage: `url('${cardNoise}')`, backgroundSize: '200% 200%', backgroundPosition: 'top left' }}
          />
        </>
      )}

      {/* Card Body */}
      <div
        onClick={onDetail ?? onClick}
        className={cn(
          "relative aspect-[280/160] flex flex-col justify-between p-5",
          !isClassicDesign && !customColor && variantColorClass[variant],
          (onDetail || onClick) && "cursor-pointer active:brightness-95 transition-all"
        )}
        style={!isClassicDesign ? surfaceStyle : undefined}
      >
        {!isClassicDesign && (
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{ backgroundImage: `url('${cardNoise}')`, backgroundSize: '200% 200%', backgroundPosition: 'top left' }}
          />
        )}

        <img
          src={zappiLogo}
          alt=""
          aria-hidden="true"
          className={cn(
            "absolute opacity-80 pointer-events-none z-10",
            isClassicDesign
              ? "bottom-4 right-4 w-12 h-12 object-contain"
              : "bottom-2 right-3 w-20 h-20",
          )}
        />

        {/* Top: Logo + Name */}
        <div className="relative z-10">
          <div className="flex items-center gap-2">
            <div className="rounded-full flex items-center justify-center overflow-hidden shrink-0 w-[22px] h-[22px]">
              <MintLogo iconUrl={mint.iconUrl} />
            </div>
            {isEditing && onRename ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.slice(0, LIMITS.MAX_MINT_NAME_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
                onBlur={handleSave}
                maxLength={LIMITS.MAX_MINT_NAME_LENGTH}
                className={cn(
                  "font-display text-body font-semibold leading-tight rounded-md px-2 py-0.5 outline-none min-w-0 w-32",
                  inputToneClass,
                )}
              />
            ) : (
              <span className={cn("font-display text-amount font-bold leading-tight whitespace-nowrap truncate", primaryInk)}>
                {displayName}
              </span>
            )}
          </div>
          {mint.mintName && mint.mintName !== displayName && (
            <p className={cn("text-overline truncate leading-tight mt-0.5 ml-[30px]", subtleInk)}>{mint.mintName}</p>
          )}
        </div>

        {/* Bottom: Balance */}
        <div className="relative z-10">
          <p className={cn("font-display text-overline font-medium uppercase tracking-wider", mutedInk)}>
            Balance
          </p>
          {hideBalance ? (
            <p className={cn("font-display text-amount-lg font-bold tracking-[2px] mt-0.5", strongInk)}>••••</p>
          ) : (
            <>
              <p className={cn("font-display text-amount-lg font-bold leading-tight mt-0.5", primaryInk)}>
                {formatSats(mint.balance)}
              </p>
              {(() => {
                const fiatStr = toFiat(mint.balance);
                return fiatStr ? (
                  <p className={cn("font-display text-overline font-medium leading-normal mt-0.5", subtleInk)}>
                    {fiatStr}
                  </p>
                ) : null;
              })()}
            </>
          )}
        </div>
      </div>

      {/* Card Footer — Action Buttons */}
      {(onReceive || onSend) && (
        <div
          className={cn(
            "relative",
            !isClassicDesign && !customColor && variantColorClass[variant],
          )}
          style={!isClassicDesign ? surfaceStyle : undefined}
        >
          <div className={cn("h-px", hairlineClass)} />
          <div className={cn("flex", footerSurfaceClass)}>
            {onReceive && (
              <button
                onClick={(e) => { e.stopPropagation(); hapticTap(); onReceive(); }}
                className={cn("flex-1 flex items-center justify-center gap-2 py-3 transition-colors", primaryInk, actionActiveClass)}
              >
                <ArrowDownLeft className="w-[18px] h-[18px]" strokeWidth={2} />
                <span className="text-subtitle font-semibold">{t('common.receive')}</span>
              </button>
            )}
            {onReceive && onSend && (
              <div className={cn("w-px my-2", hairlineClass)} />
            )}
            {onSend && (
              <button
                onClick={(e) => { e.stopPropagation(); hapticTap(); onSend(); }}
                disabled={sendDisabled}
                className={cn("flex-1 flex items-center justify-center gap-2 py-3 transition-colors disabled:opacity-40", primaryInk, actionActiveClass)}
              >
                <ArrowUpRight className="w-[18px] h-[18px]" strokeWidth={2} />
                <span className="text-subtitle font-semibold">{t('common.send')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
