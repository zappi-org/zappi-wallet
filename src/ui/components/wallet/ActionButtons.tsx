import { BarChart3, ArrowLeftRight, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ActionButtonsProps {
  onScan: () => void;
  onTransfer?: () => void;
  onAnalytics?: () => void;
  disabled?: boolean;
}

export function ActionButtons({
  onScan,
  onTransfer,
  onAnalytics,
  disabled = false,
}: ActionButtonsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-around items-end w-full px-6 py-2">
      {/* Transfer Button */}
      <button
        onClick={onTransfer}
        disabled={disabled || !onTransfer}
        aria-label={t('actions.transfer')}
        className="group flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed active:scale-90 transition-transform touch-manipulation"
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[#4A4A4A] hover:bg-background-hover transition-colors">
          <ArrowLeftRight className="w-6 h-6" strokeWidth={1.5} />
        </div>
        <span className="text-xs text-foreground-muted font-medium">{t('actions.transfer')}</span>
      </button>

      {/* Center Scan Button */}
      <button
        onClick={onScan}
        disabled={disabled}
        aria-label={t('actions.scan')}
        className="group flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.92] transition-transform touch-manipulation"
      >
        <div
          className="w-[60px] h-[60px] rounded-[22px] flex items-center justify-center shadow-[0_6px_20px_rgba(61,94,58,0.27)] hover:shadow-[0_8px_28px_rgba(61,94,58,0.35)] transition-all duration-300 group-disabled:shadow-none"
          style={{ background: "linear-gradient(145deg, #6B8F5E 0%, #3D5E3A 100%)" }}
        >
          <ScanLine className="w-7 h-7 text-white" strokeWidth={1.5} />
        </div>
        <span className="text-xs text-accent-primary font-semibold">{t('actions.scan')}</span>
      </button>

      {/* Analytics Button */}
      <button
        onClick={onAnalytics}
        disabled={disabled || !onAnalytics}
        aria-label={t('actions.analytics')}
        className="group flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed active:scale-90 transition-transform touch-manipulation"
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[#4A4A4A] hover:bg-background-hover transition-colors">
          <BarChart3 className="w-6 h-6" strokeWidth={1.5} />
        </div>
        <span className="text-xs text-foreground-muted font-medium">{t('actions.analytics')}</span>
      </button>
    </div>
  );
}
