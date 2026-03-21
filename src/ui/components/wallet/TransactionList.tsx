import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Zap, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Transaction } from "@/core/types";
import { useMintMetadata } from "@/hooks";
import { useFormatSats, useFormatFiat, formatTransactionFiat, formatDateLocalized } from "@/utils/format";
import { cn } from "@/lib/utils";

interface TransactionListProps {
  transactions: Transaction[];
  onSeeAll?: () => void;
  onTransactionClick?: (tx: Transaction) => void;
  maxItems?: number;
  showHeader?: boolean;
  className?: string;
}

// Get icon based on transaction type and direction
function getTransactionIcon(tx: Transaction) {
  if (tx.type === "swap") {
    return ArrowRightLeft;
  }
  if (tx.direction === "receive") {
    return ArrowDownLeft;
  }
  if (tx.type === "lightning") {
    return Zap;
  }
  if (tx.type === "nutzap") {
    return Heart;
  }
  return ArrowUpRight;
}

export function TransactionList({
  transactions,
  onSeeAll,
  onTransactionClick,
  maxItems = 5,
  showHeader = true,
  className,
}: TransactionListProps) {
  const { t, i18n } = useTranslation();
  const formatSats = useFormatSats();
  const toFiat = useFormatFiat();
  const displayTransactions = transactions.slice(0, maxItems);

  // Collect all mint URLs for metadata lookup
  const mintUrls = useMemo(() => {
    const urls = new Set<string>();
    displayTransactions.forEach((tx) => {
      urls.add(tx.mintUrl);
      if (tx.type === "swap" && tx.metadata?.toMintUrl) {
        urls.add(tx.metadata.toMintUrl as string);
      }
      if (tx.type === "swap" && tx.metadata?.fromMintUrl) {
        urls.add(tx.metadata.fromMintUrl as string);
      }
    });
    return Array.from(urls);
  }, [displayTransactions]);

  const { getDisplayName } = useMintMetadata(mintUrls);

  return (
    <div className={cn("flex flex-col w-full px-6 py-1", className)}>
      {showHeader && (
        <div className="flex items-center justify-between pt-[4px] mb-2">
          <div />
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className={`text-label text-foreground-muted hover:text-foreground transition-colors ${transactions.length === 0 ? 'invisible' : ''}`}
            >
              {t('home.seeAll')}
            </button>
          )}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="flex items-center justify-center h-[75px] text-foreground-muted">
          <p className="text-caption opacity-60">{t('home.noTransactions')}</p>
        </div>
      ) : (
      <div className="flex flex-col border border-border rounded-[13px] overflow-hidden gap-0">
        {displayTransactions.map((tx) => {
          const Icon = getTransactionIcon(tx);
          const isSwap = tx.type === "swap";
          const isIncome = tx.direction === "receive";

          // For swap transactions
          const fromMintName = isSwap && tx.metadata?.fromMintUrl
            ? getDisplayName(tx.metadata.fromMintUrl as string)
            : getDisplayName(tx.mintUrl);
          const toMintName = isSwap && tx.metadata?.toMintUrl
            ? getDisplayName(tx.metadata.toMintUrl as string)
            : null;

          // Generate title and subtitle
          let title: string;
          let subtitle: string;
          let amountColor: string;

          if (isSwap && !tx.memo) {
            title = t('history.swap');
            subtitle = "";
            amountColor = "text-foreground-muted";
          } else {
            title = tx.memo || (isIncome ? t('history.received') : t('history.sent'));
            if (tx.type === "lightning" && tx.direction === "send" && tx.metadata?.destination) {
              const dest = tx.metadata.destination as string;
              subtitle = dest.includes("@")
                ? dest
                : `${dest.slice(0, 20)}...`;
            } else if (tx.source && tx.source !== 'unknown') {
              const sourceLabel = t(`txDetail.source.${tx.source}`);
              subtitle = `${sourceLabel} · ${getDisplayName(tx.mintUrl)}`;
            } else {
              subtitle = getDisplayName(tx.mintUrl);
            }
            amountColor = isIncome ? "text-foreground" : "text-foreground";
          }

          return (
            <div
              key={tx.id}
              onClick={() => onTransactionClick?.(tx)}
              className="flex items-center justify-between bg-background-card rounded-[16px] h-[75px] px-[16px] py-[12px] cursor-pointer"
            >
              <div className="flex items-center gap-[12px]">
                <div className={cn("w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0", isSwap ? "bg-foreground/[0.06]" : isIncome ? "bg-accent-success/10" : "bg-accent-warning/10")}>
                  <Icon size={20} strokeWidth={1.5} className={isSwap ? "text-foreground" : isIncome ? "text-accent-success" : "text-accent-warning"} />
                </div>
                <div className="flex flex-col gap-[2px]">
                  <h3 className="text-body-bold text-foreground leading-normal">
                    {title}
                  </h3>
                  {isSwap ? (
                    <div className="flex flex-col text-label text-foreground-muted leading-normal">
                      <span className="truncate max-w-[140px]">{fromMintName}</span>
                      <span className="truncate max-w-[140px]">→ {toMintName}</span>
                    </div>
                  ) : (
                    <p className="text-label text-foreground-muted truncate max-w-[160px] leading-normal">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-[2px]">
                <span className={`text-body-bold font-display ${amountColor} leading-normal`}>
                  {isSwap
                    ? formatSats(tx.amount)
                    : isIncome
                      ? `+ ${formatSats(tx.amount)}`
                      : `- ${formatSats(tx.amount)}`
                  }
                </span>
                {(() => {
                  const fiatStr = formatTransactionFiat(tx, toFiat)
                  return fiatStr ? (
                    <span className="text-overline text-foreground-muted/70 leading-normal">
                      {fiatStr}
                    </span>
                  ) : null
                })()}
                <span className="text-label text-foreground-muted leading-normal">
                  {formatDateLocalized(tx.createdAt, i18n.language, t('history.today'), t('history.yesterday'))}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      )}

    </div>
  );
}
