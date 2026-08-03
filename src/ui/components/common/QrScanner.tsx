import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  CameraNotFoundError,
  CameraPermissionError,
  ManagedQrScanner,
  type ScanResult,
} from "@/ui/lib/qr-engine";
import { createQrPerformanceRecorder } from "@/ui/lib/qr-performance";
import { URDecoder } from "@gandlaf21/bc-ur";
import { usePinchZoom } from "@/ui/hooks/use-pinch-zoom";

export interface QrScannerProps {
  onScan: (result: string) => void;
  onError?: (error: string) => void;
  active?: boolean;
  paused?: boolean;
}

export function QrScanner({ onScan, onError, active = true, paused = false }: QrScannerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<ManagedQrScanner | null>(null);
  const resetUrPerformanceMarkRef = useRef<(() => void) | null>(null);
  const urDecoderRef = useRef<URDecoder | null>(null);
  const seenUrFragmentsRef = useRef(new Set<string>());
  const lastScannedDataRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasCamera, setHasCamera] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [urProgress, setUrProgress] = useState(0);

  // Pinch-to-zoom
  const {
    zoomLevel,
    videoStyle,
    scanGuideStyle,
    getGuideScanRegion,
  } = usePinchZoom({
    containerRef,
    videoRef,
    enabled: active && isReady,
  });
  const getGuideScanRegionRef = useRef(getGuideScanRegion);
  const activeRef = useRef(active);
  const pausedRef = useRef(paused);
  useLayoutEffect(() => {
    activeRef.current = active;
    pausedRef.current = paused;
  }, [active, paused]);

  // Stable callback refs
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
    getGuideScanRegionRef.current = getGuideScanRegion;
  }, [onScan, onError, getGuideScanRegion]);
  const handleScan = useCallback((
    result: ScanResult,
    markFirstUrFragment: () => void,
  ) => {
    if (!activeRef.current || pausedRef.current) return;
    if (!result?.data) return;

    const data = result.data;

    // Check if this is a UR (animated/multipart) QR code
    if (data.toLowerCase().startsWith("ur:")) {
      if (import.meta.env.DEV) markFirstUrFragment();
      if (seenUrFragmentsRef.current.has(data)) return;
      seenUrFragmentsRef.current.add(data);

      // Initialize decoder if needed
      if (!urDecoderRef.current) {
        urDecoderRef.current = new URDecoder();
      }

      const decoder = urDecoderRef.current;
      decoder.receivePart(data);
      setUrProgress(decoder.estimatedPercentComplete() || 0);

      // Check if complete
      if (decoder.isComplete()) {
        if (decoder.isSuccess()) {
          const ur = decoder.resultUR();
          const decoded = ur.decodeCBOR();
          lastScannedDataRef.current = decoded.toString();
          onScanRef.current(decoded.toString());
        }
        urDecoderRef.current = null;
        seenUrFragmentsRef.current.clear();
        setUrProgress(0);
      }
    } else {
      // Skip if same data as last scan
      if (data === lastScannedDataRef.current) return;
      lastScannedDataRef.current = data;
      onScanRef.current(data);
    }
  }, []);

  // Initialize and cleanup scanner
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const seenUrFragments = seenUrFragmentsRef.current;

    let mounted = true;
    let resetUrPerformanceMark: (() => void) | null = null;

    const initScanner = async () => {
      // Let StrictMode cleanup finish before acquiring the camera.
      await Promise.resolve();
      if (!mounted) return;

      const performanceRecorder = import.meta.env.DEV
        ? createQrPerformanceRecorder({
            enabled: true,
            now: () => performance.now(),
            sink: (stage, elapsed) => console.debug(stage, elapsed),
          })
        : undefined;
      let firstUrFragmentMarked = false;
      const markFirstUrFragment = import.meta.env.DEV
        ? () => {
            if (firstUrFragmentMarked) return;
            firstUrFragmentMarked = true;
            performanceRecorder?.mark('first-ur-fragment');
          }
        : () => {};
      resetUrPerformanceMark = () => {
        firstUrFragmentMarked = false;
      };
      resetUrPerformanceMarkRef.current = resetUrPerformanceMark;

      // Create scanner instance
      const scanner = new ManagedQrScanner(
        video,
        (result) => handleScan(result, markFirstUrFragment),
        {
          highlightScanRegion: false,
          highlightCodeOutline: false,
          onDecodeError: () => {},
          preferredCamera: "environment",
          maxScansPerSecond: 15,
          calculateScanRegion: (v) => getGuideScanRegionRef.current(v),
          performanceRecorder,
        },
      );

      scannerRef.current = scanner;

      if (activeRef.current && !pausedRef.current) {
        try {
          await scanner.start();
          if (mounted && activeRef.current && !pausedRef.current) {
            setIsReady(true);
            setErrorMessage("");
          }
        } catch (err) {
          if (!mounted) return;
          console.error("[QrScanner] Failed to start:", err);

          const error = err as Error;
          if (error instanceof CameraPermissionError || error?.name === "NotAllowedError") {
            setErrorMessage(t("scanner.cameraPermission"));
            onErrorRef.current?.(t("scanner.cameraPermission"));
          } else if (error instanceof CameraNotFoundError || error?.name === "NotFoundError") {
            setHasCamera(false);
            setErrorMessage(t("scanner.cameraNotFound"));
            onErrorRef.current?.(t("scanner.cameraNotFound"));
          } else {
            setErrorMessage(t("scanner.cameraStartFailed"));
            onErrorRef.current?.(t("scanner.cameraStartFailed"));
          }
        }
      }
    };

    initScanner();

    return () => {
      mounted = false;
      if (resetUrPerformanceMarkRef.current === resetUrPerformanceMark) {
        resetUrPerformanceMarkRef.current = null;
      }
      if (scannerRef.current) {
        void scannerRef.current.destroy();
        scannerRef.current = null;
      }
      urDecoderRef.current = null;
      seenUrFragments.clear();
      lastScannedDataRef.current = null;
      setUrProgress(0);
      setIsReady(false);
    };
  }, [handleScan, t]);

  // Pausing keeps the stream; inactive scanners release it.
  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    let current = true;

    if (!active) {
      resetUrPerformanceMarkRef.current?.();
      lastScannedDataRef.current = null;
      scanner.stop();
      void Promise.resolve().then(() => {
        if (current) setIsReady(false);
      });
    } else if (paused) {
      resetUrPerformanceMarkRef.current?.();
      seenUrFragmentsRef.current.clear();
      lastScannedDataRef.current = null;
      void scanner.pause().catch((err) => {
        if (err?.name !== "AbortError") {
          console.error("[QrScanner] Pause error:", err);
        }
      });
    } else {
      scanner
        .start()
        .then(() => {
          if (current) {
            setIsReady(true);
            setErrorMessage("");
          }
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            console.error("[QrScanner] Start error:", err);
          }
        });
    }
    return () => {
      current = false;
    };
  }, [active, paused]);

  if (!hasCamera) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-muted rounded-xl">
        <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-destructive"
          >
            <path d="m2 2 20 20" />
            <path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
            <path d="M15 15v2" />
            <path d="M21.83 14.83A2 2 0 0 0 22 14V9a2 2 0 0 0-2-2h-9" />
          </svg>
        </div>
        <p className="text-foreground-muted text-center">
          {t("scanner.cameraNotFound")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl bg-black shadow-lg"
    >
      <video
        ref={videoRef}
        className="w-full aspect-[4/5] object-cover"
        style={videoStyle}
        playsInline
        muted
      />

      {/* Zoom indicator */}
      {zoomLevel > 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm pointer-events-none z-10">
          <span className="text-white text-label font-medium">
            {zoomLevel.toFixed(1)}x
          </span>
        </div>
      )}

      <div
        data-testid="qr-scan-guide"
        className="pointer-events-none absolute top-1/2 left-1/2 z-10 aspect-square -translate-x-1/2 -translate-y-1/2"
        style={scanGuideStyle}
      >
        <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-brand rounded-tl-[6px]" />
        <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-brand rounded-tr-[6px]" />
        <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-brand rounded-bl-[6px]" />
        <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-brand rounded-br-[6px]" />
      </div>

      {/* Loading overlay */}
      {!isReady && !errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
          <div className="w-10 h-10 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-white/70 text-caption">
            {t("scanner.cameraPreparing")}
          </p>
        </div>
      )}

      {/* UR Progress indicator for animated QR codes */}
      {urProgress > 0 && (
        <div className="absolute bottom-4 left-4 right-4">
          <div className="bg-black/70 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/90 text-label font-medium">
                {t("scanner.multipartScanning")}
              </span>
              <span className="text-accent-primary text-label font-bold">
                {Math.round(urProgress * 100)}%
              </span>
            </div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-primary rounded-full transition-all duration-200"
                style={{ width: `${urProgress * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center p-4">
            <p className="text-destructive mb-2">{errorMessage}</p>
            <p className="text-caption text-foreground-muted">
              {t("scanner.enableCameraPermission")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
