import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Zap, Banknote, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Transaction } from "@/core/types";
import { useMintMetadata } from "@/hooks";

interface TransactionListProps {
  transactions: Transaction[];
  onSeeAll?: () => void;
  onTransactionClick?: (tx: Transaction) => void;
  maxItems?: number;
  showHeader?: boolean;
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
}: TransactionListProps) {
  const { t, i18n } = useTranslation();
  const displayTransactions = transactions.slice(0, maxItems);

  // Localized date formatting
  const formatDateLocalized = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );
    const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'es' ? 'es-ES' : i18n.language === 'id' ? 'id-ID' : 'en-US';

    if (diffDays === 0) {
      return `${t('history.today')}, ${date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    if (diffDays === 1) {
      return `${t('history.yesterday')}, ${date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  };

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

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
        <Banknote className="w-10 h-10 mb-2 opacity-30" />
        <p className="text-xs">{t('home.noTransactions')}</p>
      </div>
    );
  }

  // Get icon background and color based on transaction type
  const getIconStyle = (tx: Transaction) => {
    if (tx.type === "swap") return "bg-[#F3F0EC] text-foreground-muted";
    if (tx.direction === "receive") return "bg-[#EDF2EA] text-accent-primary";
    // send
    return "bg-[#FDF2EC] text-accent-danger";
  };

  return (
    <div className="flex flex-col w-full px-6 py-2 pb-24">
      {showHeader && (
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-gray-800">{t('home.recentTransactions')}</h3>
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className="text-sm font-medium text-gray-500 hover:text-black transition-colors"
            >
              {t('home.seeAll')}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
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
            amountColor = "text-gray-500";
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
            amountColor = isIncome ? "text-gray-900" : "text-gray-900";
          }

          return (
            <div
              key={tx.id}
              onClick={() => onTransactionClick?.(tx)}
              className="flex items-center justify-between py-3 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${getIconStyle(tx)}`}>
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm">
                    {title}
                  </h3>
                  {isSwap ? (
                    <div className="flex flex-col text-xs text-gray-400 font-medium">
                      <span className="truncate max-w-[140px]">{fromMintName}</span>
                      <span className="truncate max-w-[140px]">→ {toMintName}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 font-medium truncate max-w-[160px]">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className={`font-bold text-sm ${amountColor}`}>
                  {isSwap
                    ? `₿${tx.amount.toLocaleString()}`
                    : isIncome
                      ? `+ ₿ ${tx.amount.toLocaleString()}`
                      : `- ₿ ${tx.amount.toLocaleString()}`
                  }
                </span>
                <span className="text-xs text-gray-400 font-medium">
                  {formatDateLocalized(tx.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
