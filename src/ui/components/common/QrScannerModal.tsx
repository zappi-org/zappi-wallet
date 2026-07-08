import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import QrScannerLib from "qr-scanner";
import { ClipboardPaste, Image, X } from "lucide-react";
import { QrScanner } from "./QrScanner";
import { useAppStore } from "@/store";

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (result: string) => void;
}

export function QrScannerModal({
  isOpen,
  onClose,
  onScan,
}: QrScannerModalProps) {
  const { t } = useTranslation();
  const addToast = useAppStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const imageErrorTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (imageErrorTimer.current) clearTimeout(imageErrorTimer.current);
    };
  }, []);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      e.target.value = "";
      setImageError("");
      if (imageErrorTimer.current) clearTimeout(imageErrorTimer.current);

      try {
        const result = await QrScannerLib.scanImage(file, {
          returnDetailedScanResult: true,
        });
        if (result?.data) {
          onScan(result.data);
        }
      } catch {
        setImageError(t("scanner.noQrFound"));
        imageErrorTimer.current = setTimeout(() => setImageError(""), 3000);
      }
    },
    [onScan, t]
  );

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        addToast({
          type: "error",
          message: t("scanner.unrecognizedFormat"),
          duration: 3000,
        });
        return;
      }
      onScan(text.trim());
    } catch {
      addToast({
        type: "error",
        message: t("scanner.unrecognizedFormat"),
        duration: 3000,
      });
    }
  }, [addToast, onScan, t]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex pb-4 items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-background rounded-2xl mx-3 w-full overflow-hidden animate-slideInUp shadow-[0_-8px_40px_rgba(0,0,0,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-center px-5 py-6">
          <h2 className="text-[14px] leading-normal font-semibold">
            {t("scanner.title")}
          </h2>
          <button
            onClick={onClose}
            className="absolute right-5 w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-sm text-foreground-muted active:bg-neutral-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4">
          <QrScanner onScan={onScan} active={isOpen} />
        </div>

        <div className="flex gap-3 px-5 pt-6 pb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white border border-foreground-muted text-foreground-muted rounded-card font-medium text-[11px] leading-normal shadow-sm active:scale-[0.98] transition-transform"
          >
            <Image className="w-5 h-5" strokeWidth={1.8} />
            {t("scanner.loadFromPhoto")}
          </button>
          <button
            onClick={handlePaste}
            className="flex-2 flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-card font-medium text-[11px] leading-normal shadow-lg active:scale-[0.98] transition-transform"
          >
            <ClipboardPaste className="w-5 h-5" strokeWidth={1.8} />
            {t("scanner.paste")}
          </button>
        </div>

        {imageError && (
          <div className="px-5 pb-4">
            <p className="text-caption text-accent-danger text-center">
              {imageError}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
