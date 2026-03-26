import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowUpRight, Pencil } from "lucide-react";
import type { MintInfo } from "@/core/types";
import { cn } from "@/lib/utils";
import { useFormatSats, useFormatFiat } from "@/utils/format";
import { hapticTap } from "@/utils/haptic";
import cardLogo from "@/assets/card-logo.svg";
import cardNoise from "@/assets/card-noise.png";
import zappiLogo from "@/assets/zappi.png";

export type MintCardVariant = "light" | "medium" | "dark" | "darker" | "indigo" | "coral" | "teal" | "slate" | "amber" | "plum" | "forest";

interface MintCardProps {
  mint: MintInfo;
  variant?: MintCardVariant;
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
  const sizeClasses = "w-6 h-6";

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

// eslint-disable-next-line react-refresh/only-export-components
export function getVariantByIndex(index: number): MintCardVariant {
  const variants: MintCardVariant[] = ["indigo", "coral", "teal", "slate", "amber", "plum", "forest"];
  return variants[index % variants.length];
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

export function MintCard({
  mint,
  variant = "medium",
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
  const displayName = mint.alias || getMintShortName(mint.url, mint.name);

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

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayName);
    setIsEditing(true);
  }, [displayName]);

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
        "relative w-[var(--card-w)] rounded-[13px] overflow-hidden touch-manipulation",
        "shadow-[0px_4px_8px_0px_rgba(0,0,0,0.15)]",
        isSelected === true && "ring-2 ring-primary ring-offset-3 ring-offset-background",
        isSelected === false && "opacity-70"
      )}
    >
      {/* Card Body */}
      <div
        onClick={onDetail ?? onClick}
        className={cn(
          "relative aspect-[280/160] flex flex-col justify-between p-5",
          variantColorClass[variant],
          (onDetail || onClick) && "cursor-pointer active:brightness-95 transition-all"
        )}
      >
        {/* Noise texture */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: `url('${cardNoise}')`, backgroundSize: '200% 200%', backgroundPosition: 'top left' }}
        />

        {/* Zappi logo watermark — bottom right */}
        <img
          src={zappiLogo}
          alt=""
          aria-hidden="true"
          className="absolute bottom-2 right-3 w-24 h-24 opacity-80 pointer-events-none"
        />

        {/* Top: Logo + Name */}
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="rounded-full flex items-center justify-center overflow-hidden shrink-0 w-[25px] h-[27px]">
            <MintLogo iconUrl={mint.iconUrl} />
          </div>
          {isEditing && onRename ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value.slice(0, 10))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              onBlur={handleSave}
              maxLength={10}
              className="font-display text-body-bold font-semibold text-white leading-tight bg-white/15 rounded-md px-2 py-0.5 outline-none min-w-0 w-32"
            />
          ) : (
            <button
              onClick={onRename ? handleStartEdit : undefined}
              className={cn(
                "flex items-center gap-1.5 min-w-0",
                onRename && "cursor-pointer"
              )}
            >
              <span className="font-display text-body-bold font-semibold text-white leading-tight whitespace-nowrap truncate">
                {displayName}
              </span>
              {onRename && (
                <Pencil className="w-3 h-3 text-white/50 shrink-0" />
              )}
            </button>
          )}
        </div>

        {/* Bottom: Balance */}
        <div className="relative z-10">
          <p className="font-display text-overline font-medium text-white/50 uppercase tracking-wider">
            Balance
          </p>
          {hideBalance ? (
            <p className="font-display text-amount-lg font-bold text-white/80 tracking-[2px] mt-0.5">••••</p>
          ) : (
            <>
              <p className="font-display text-amount-lg font-bold text-white leading-tight mt-0.5">
                {formatSats(mint.balance)}
              </p>
              {(() => {
                const fiatStr = toFiat(mint.balance);
                return fiatStr ? (
                  <p className="font-display text-overline font-medium text-white/45 leading-normal mt-0.5">
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
        <div className={cn("relative", variantColorClass[variant])}>
          <div className="h-px bg-white/12" />
          <div className="bg-black/8 flex">
            {onReceive && (
              <button
                onClick={(e) => { e.stopPropagation(); hapticTap(); onReceive(); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-white active:bg-white/10 transition-colors"
              >
                <ArrowDownLeft className="w-[18px] h-[18px]" strokeWidth={2} />
                <span className="text-caption font-semibold">{t('common.receive')}</span>
              </button>
            )}
            {onReceive && onSend && (
              <div className="w-px bg-white/12 my-2" />
            )}
            {onSend && (
              <button
                onClick={(e) => { e.stopPropagation(); hapticTap(); onSend(); }}
                disabled={sendDisabled}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-white active:bg-white/10 transition-colors disabled:opacity-40"
              >
                <ArrowUpRight className="w-[18px] h-[18px]" strokeWidth={2} />
                <span className="text-caption font-semibold">{t('common.send')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
