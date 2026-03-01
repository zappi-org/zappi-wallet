import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Zap, Banknote, Heart, List } from "lucide-react";
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
  onSeeAll: _onSeeAll,
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

  return (
    <div className="flex flex-col w-full px-6 py-4">
      {showHeader && (
        <div className="flex items-center justify-center gap-[6px] pt-[10px] mb-4">
          <List className="w-4 h-4 text-[#86868b]" />
          <span className="font-['Outfit'] font-medium text-[14px] text-[#86868b]">History</span>
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="flex items-center justify-center h-[75px] text-foreground-muted">
          <p className="text-xs opacity-50">{t('home.noTransactions')}</p>
        </div>
      ) : (
      <div className="flex flex-col shadow-[-1px_2px_4px_white,0px_4px_4px_rgba(0,0,0,0.1)]">
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
            amountColor = isIncome ? "text-[#1d1d1f]" : "text-[#1d1d1f]";
          }

          return (
            <div
              key={tx.id}
              onClick={() => onTransactionClick?.(tx)}
              className="flex items-center justify-between bg-[#faf9f6] rounded-[16px] h-[75px] px-[16px] pb-[12px] cursor-pointer"
            >
              <div className="flex items-center gap-[12px]">
                <div className="w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0 bg-[#e6e6e6]">
                  <Icon size={20} strokeWidth={1.5} className="text-[#1d1d1f]" />
                </div>
                <div className="flex flex-col gap-[2px]">
                  <h3 className="font-['Outfit'] font-bold text-[14px] text-[#1d1d1f] leading-normal">
                    {title}
                  </h3>
                  {isSwap ? (
                    <div className="flex flex-col font-['Outfit'] font-medium text-[12px] text-[#86868b] leading-normal">
                      <span className="truncate max-w-[140px]">{fromMintName}</span>
                      <span className="truncate max-w-[140px]">→ {toMintName}</span>
                    </div>
                  ) : (
                    <p className="font-['Outfit'] font-medium text-[12px] text-[#86868b] truncate max-w-[160px] leading-normal">
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-[2px]">
                <span className={`font-['Outfit'] font-bold text-[14px] ${amountColor} leading-normal`}>
                  {isSwap
                    ? `₿${tx.amount.toLocaleString()}`
                    : isIncome
                      ? `+ ₿ ${tx.amount.toLocaleString()}`
                      : `- ₿ ${tx.amount.toLocaleString()}`
                  }
                </span>
                <span className="font-['Outfit'] font-medium text-[12px] text-[#86868b] leading-normal">
                  {formatDateLocalized(tx.createdAt)}
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
