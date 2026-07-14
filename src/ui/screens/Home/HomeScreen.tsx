import { useState, useEffect, useMemo, useCallback } from "react";
import { useCarouselScroll } from "@/ui/hooks/use-carousel-scroll";
import { usePullToRefresh } from "@/ui/hooks/use-pull-to-refresh";
import { Plus, LoaderCircle, ArrowDown, Eye, EyeOff, CircleUserRound, Copy, Check } from "lucide-react";

import { useTranslation } from "react-i18next";
import { CameraFilled } from "@/ui/components/icons/CameraFilled";
import { hapticTap } from "@/ui/utils/haptic";
import { MintCard, resolveMintColor } from "../../components/wallet/MintCard";
import { HomeRecentCard } from "../../components/wallet/HomeRecentCard";
import { BottomSheet } from "@/ui/components/common/BottomSheet";
import { Button } from "@/ui/components/common/Button";
import { QRCodeDisplay } from "@/ui/components/common/QRCodeDisplay";
import { useWallet, useMintHealth, useMintMetadata } from "@/ui/hooks";
import { useCrypto } from "@/ui/hooks/use-crypto";
import { useAppStore } from "@/store";
import { useSatUnit, useFormatFiat, getLocaleCode } from "@/utils/format";
import { getMintBalance } from "@/utils/url";
import type { MintInfo } from "@/core/types";
import type { Transaction } from "@/core/domain/transaction";
// Transaction loading via props or store — no direct repo access in UI

export interface HomeScreenProps {
  onSettings?: () => void;
  onNotifications?: () => void;
  onTransactions?: (mintUrl?: string) => void;
  onAddMint?: () => void;
  onMintDetails?: (mint: MintInfo, index: number) => void;
  onSend?: (activeMintUrl?: string) => void;
  onReceive?: (activeMintUrl?: string) => void;
  onScan?: () => void;
  onSelectTransaction?: (tx: Transaction) => void;
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>;
  onRefresh?: () => Promise<void>;
  transactions?: Transaction[];
}

export function HomeScreen({
  onTransactions,
  onAddMint,
  onMintDetails,
  onSend,
  onReceive,
  onScan,
  onSelectTransaction,
  onSaveSettings,
  onRefresh,
  transactions: propTransactions,
}: HomeScreenProps) {
  const { t, i18n } = useTranslation();
  const unit = useSatUnit();
  const toFiat = useFormatFiat();
  const [activeMintIndex, setActiveMintIndex] = useState(0);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [profileCopied, setProfileCopied] = useState(false);

  const transactions = useMemo(
    () => propTransactions ?? [],
    [propTransactions]
  );

  const { balance, isLoadingBalance } = useWallet();
  const { checkAllMints, getCachedStatus } = useMintHealth();
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const nostrPubkey = useAppStore((state) => state.nostrPubkey);
  const addToast = useAppStore((state) => state.addToast);
  const crypto = useCrypto();
  const { getDisplayName, getOriginalName, getIconUrl } = useMintMetadata(
    settings?.mints || []
  );

  // Pull-to-refresh
  const noopRefresh = useCallback(async () => {}, []);
  const { scrollContainerRef, indicatorRef, iconRef, isRefreshing } =
    usePullToRefresh({
      onRefresh: onRefresh ?? noopRefresh,
    });

  // Transactions are provided via props from MainApp
  // No fallback to direct repo access (hex architecture compliance);

  useEffect(() => {
    checkAllMints();
  }, [checkAllMints]);

  const mintUrls = settings.mints;
  const mintAliases = settings.mintAliases;
  const mints: MintInfo[] = useMemo(() => {
    return mintUrls.map((url) => {
      const cachedStatus = getCachedStatus(url);
      const alias = mintAliases?.[url];
      return {
        url,
        name: getDisplayName(url),
        alias,
        mintName: getOriginalName(url),
        iconUrl: getIconUrl(url),
        balance: getMintBalance(url, balance.byMint),
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      };
    });
  }, [
    mintUrls,
    balance.byMint,
    getCachedStatus,
    getDisplayName,
    getOriginalName,
    getIconUrl,
    mintAliases,
  ]);

  const totalBalance = balance.total;
  const npub = useMemo(
    () => (nostrPubkey ? crypto.encodeNpub(nostrPubkey) : ""),
    [crypto, nostrPubkey]
  );

  const { carouselRef, cardRefs, handleScroll } = useCarouselScroll({
    itemCount: mints.length,
    onIndexChange: setActiveMintIndex,
    scaleAnimation: true,
    fallbackGap: 24,
  });

  const clampedMintIndex =
    mints.length === 0 ? 0 : Math.min(activeMintIndex, mints.length - 1);

  const filteredTransactions = useMemo(() => {
    const selectedMint = mints[clampedMintIndex];
    if (!selectedMint) return transactions;
    const url = selectedMint.url;
    const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
    return transactions.filter((tx) => {
      if (tx.status === "failed") return false;
      const txUrl = tx.accountId?.endsWith("/")
        ? tx.accountId.slice(0, -1)
        : tx.accountId;
      return txUrl === normalized || txUrl === url;
    });
  }, [transactions, mints, clampedMintIndex]);

  const recentTransaction = useMemo(() => {
    return filteredTransactions.length > 0 ? filteredTransactions[0] : null
  }, [filteredTransactions]);

  const recentDateLabel = useMemo(() => {
    if (!recentTransaction) return ''
    const locale = getLocaleCode(i18n.language)
    return new Date(recentTransaction.createdAt).toLocaleDateString(locale, {
      month: 'long',
      day: 'numeric',
    })
  }, [recentTransaction, i18n.language]);

  const handleBalanceVisibilityToggle = useCallback(() => {
    hapticTap();
    const updated = { balanceHidden: !settings.balanceHidden };
    updateSettings(updated);
    onSaveSettings?.({ ...settings, ...updated });
  }, [onSaveSettings, settings, updateSettings]);

  const handleProfileOpen = useCallback(() => {
    hapticTap();
    setProfileCopied(false);
    setProfileSheetOpen(true);
  }, []);

  const handleProfileCopy = useCallback(async () => {
    if (!npub) return;
    hapticTap();

    try {
      await navigator.clipboard.writeText(npub);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = npub;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    setProfileCopied(true);
    addToast({ type: "success", message: t("toast.copied"), duration: 1500 });
    setTimeout(() => setProfileCopied(false), 2000);
  }, [addToast, npub, t]);

  return (
    <div
      ref={scrollContainerRef as React.RefObject<HTMLDivElement>}
      className="h-dvh bg-background text-foreground font-primary overflow-hidden flex flex-col pt-safe"
      style={{ overscrollBehaviorY: "contain" }}
    >
      {/* Pull-to-refresh indicator */}
      <div
        ref={indicatorRef}
        className="flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 0, opacity: 0 }}
      >
        {isRefreshing ? (
          <LoaderCircle className="w-6 h-6 text-foreground-muted animate-spin" />
        ) : (
          <ArrowDown
            ref={iconRef}
            className="w-5 h-5 text-foreground-muted transition-transform duration-150"
          />
        )}
      </div>

      {/* Header — profile + scan */}
      <div className="shrink-0 h-14 px-5 flex items-center justify-between">
        <button
          type="button"
          onClick={handleProfileOpen}
          aria-label={t("settings.profile")}
          className="w-10 h-10 rounded-full flex items-center justify-center text-foreground-muted hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
        >
          <CircleUserRound className="w-6 h-6" strokeWidth={1.8} />
        </button>
        {onScan && (
          <button
            type="button"
            onClick={() => {
              hapticTap();
              onScan();
            }}
            aria-label={t('scanner.title')}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-foreground-muted hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors"
          >
            <CameraFilled />
          </button>
        )}
      </div>

      {/* Fixed top: Balance + Cards */}
      <div className="shrink-0">
        {/* Total Balance — Hero */}
        <button
          type="button"
          onClick={handleBalanceVisibilityToggle}
          aria-label={
            settings.balanceHidden
              ? t("home.showBalance")
              : t("home.hideBalance")
          }
          className="group flex w-full flex-col items-center px-5 pt-4 pb-1 text-center transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-body font-medium text-foreground-muted tracking-wide uppercase">
              Total
            </span>
            {settings.balanceHidden ? (
              <EyeOff className="h-4 w-4 text-foreground-muted transition-colors group-hover:text-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-foreground-muted transition-colors group-hover:text-foreground" />
            )}
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            {settings.balanceHidden ? (
              <span className="text-display font-bold font-display text-foreground tracking-[2px]">
                ••••
              </span>
            ) : isLoadingBalance ? (
              <span className="text-display font-bold font-display text-foreground tracking-[2px] animate-shimmer">
                ...
              </span>
            ) : (
              <>
                {unit === "₿" && (
                  <span className="text-display font-bold font-display text-foreground">
                    {unit}
                  </span>
                )}
                <span className="text-display font-bold font-display text-foreground tracking-[-0.5px]">
                  {totalBalance.toLocaleString()}
                </span>
                {unit !== "₿" && (
                  <span className="text-display font-bold font-display text-foreground">
                    {unit}
                  </span>
                )}
              </>
            )}
          </div>
          {(() => {
            const fiatStr = !isLoadingBalance ? toFiat(totalBalance) : null;
            return fiatStr ? (
              <p
                className={`text-body text-foreground-muted mt-0.5 ${
                  settings.balanceHidden ? "invisible" : ""
                }`}
              >
                {fiatStr}
              </p>
            ) : (
              <p className="text-body mt-0.5 invisible">-</p>
            );
          })()}
        </button>

        {/* Card Carousel */}
        <div className="relative w-full pt-4 pb-2">
          {mints.length === 0 ? (
            <div className="flex justify-center items-center px-5">
              <button
                onClick={onAddMint}
                className="w-[var(--card-w)] aspect-[280/176] rounded-card border-2 border-dashed border-border flex flex-col items-center justify-center text-foreground-subtle gap-2"
              >
                <Plus className="w-6 h-6" />
                <span className="text-caption font-medium">
                  {t("home.addFirstMint")}
                </span>
              </button>
            </div>
          ) : (
            <>
              <div
                ref={carouselRef}
                onScroll={handleScroll}
                className="flex gap-1 px-[calc(50%-var(--card-w)/2)] overflow-x-auto overflow-y-visible snap-x snap-mandatory scrollbar-hide pb-2"
              >
                {mints.map((mint, idx) => (
                  <div
                    key={mint.url}
                    ref={(el) => {
                      cardRefs.current[idx] = el;
                    }}
                    className="snap-center snap-always shrink-0 will-change-transform"
                  >
                    <MintCard
                      mint={mint}
                      {...resolveMintColor(mint.url, idx, settings.mintColors)}
                      hideBalance={settings.balanceHidden}
                      onDetail={() => onMintDetails?.(mints[idx], idx)}
                      onSend={() => onSend?.(mint.url)}
                      onReceive={() => onReceive?.(mint.url)}
                    />
                  </div>
                ))}
                {/* Add card button */}
                <div className="snap-center shrink-0 flex items-center justify-center px-4">
                  <button
                    onClick={onAddMint}
                    aria-label={t("settings.addMint")}
                    className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center text-foreground-subtle hover:bg-background-hover transition-all"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Pagination Dots */}
              {mints.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  {mints.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-1.5 h-1.5 rounded-full ${
                        idx === clampedMintIndex ? "bg-foreground" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Single recent transaction — pinned above toolbar */}
      {recentTransaction ? (
        <HomeRecentCard
          className="mt-auto"
          transaction={recentTransaction}
          dateLabel={recentDateLabel}
          onPress={() => onSelectTransaction?.(recentTransaction)}
          onSeeAll={() => onTransactions?.(mints[clampedMintIndex]?.url)}
        />
      ) : (
        <div className="mt-auto shrink-0 pb-app-nav px-4 w-full max-w-sm mx-auto">
          <p className="text-caption text-foreground-muted text-center py-2">
            {t('home.noTransactions')}
          </p>
        </div>
      )}

      <BottomSheet
        isOpen={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
        title={t("settings.profile")}
      >
        <div className="flex flex-col items-center px-6 pt-8 pb-6 pb-safe">
          <div className="flex w-full flex-col items-center text-center">
            {npub ? (
              <>
                <button
                  type="button"
                  onClick={handleProfileCopy}
                  aria-label={t("common.copy")}
                  className="rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <QRCodeDisplay value={npub} size={200} className="rounded-xl p-0 shadow-none" fill />
                </button>
                <p className="mt-6 text-body font-medium text-foreground text-center break-all leading-relaxed px-4">
                  {npub}
                </p>
              </>
            ) : (
              <p className="text-body text-foreground-muted">
                {t("common.loading")}
              </p>
            )}
          </div>

          <Button
            variant="brand"
            size="lg"
            onClick={handleProfileCopy}
            disabled={!npub}
            className="mt-6 w-full max-w-[320px]"
          >
            {profileCopied ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                {t("common.copied")}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                {t("common.copy")}
              </>
            )}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
