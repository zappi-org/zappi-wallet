import { useState, useCallback, useEffect } from "react";
import zappiLogo from "@/assets/zappi.png";
import { useTranslation } from "react-i18next";
import { CountdownTimer } from "@/ui/components/common";
import { NumericKeypad } from "@/ui/components/common/NumericKeypad";
import { useAppStore } from "@/store";
import {
  isPasskeySupported,
  isPasskeyRegistered,
  authenticateWithPasskey,
} from "@/services/passkey";

// Face ID icon
const FaceIdIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className || "w-6 h-6"}
  >
    <path d="M9 10V9" />
    <path d="M15 10V9" />
    <path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
    <path d="M7 3H5a2 2 0 0 0-2 2v2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M17 21h2a2 2 0 0 0 2-2v-2" />
  </svg>
);

export interface LockScreenProps {
  onUnlock: (password: string) => Promise<boolean>;
  maxAttempts?: number;
  lockoutDurationMinutes?: number;
}

export function LockScreen({
  onUnlock,
  maxAttempts = 5,
  lockoutDurationMinutes = 15,
}: LockScreenProps) {
  const { t } = useTranslation();
  const addToast = useAppStore((s) => s.addToast);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [shake, setShake] = useState(false);

  // Check passkey availability
  useEffect(() => {
    const available = isPasskeySupported() && isPasskeyRegistered();
    setPasskeyAvailable(available);
  }, []);

  // Auto-trigger passkey on mount if available (silent — no toast on failure)
  useEffect(() => {
    if (passkeyAvailable && !isLoading) {
      handlePasskeyAuth(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkeyAvailable]);

  // Load lockout state from storage
  useEffect(() => {
    const stored = localStorage.getItem("lockout");
    if (stored) {
      const { until, attempts } = JSON.parse(stored);
      if (until > Date.now()) {
        setLockoutUntil(until);
        setFailedAttempts(attempts);
      } else {
        localStorage.removeItem("lockout");
      }
    }
  }, []);

  const handleLockoutExpired = useCallback(() => {
    setLockoutUntil(null);
    setFailedAttempts(0);
    localStorage.removeItem("lockout");
  }, []);

  const isLockedOut = lockoutUntil !== null && lockoutUntil > Date.now();

  const handlePasskeyAuth = useCallback(async (silent = false) => {
    if (isLockedOut || isLoading) return;

    setIsLoading(true);
    setError("");

    try {
      const pin = await authenticateWithPasskey();
      if (pin) {
        const success = await onUnlock(pin);
        if (success) {
          setFailedAttempts(0);
          localStorage.removeItem("lockout");
          return;
        }
      }
    } catch {
      // fall through
    }
    if (!silent) {
      addToast({
        type: 'error',
        message: t('lock.biometricFailed'),
        duration: 3000,
      });
    }
    setIsLoading(false);
  }, [isLockedOut, isLoading, onUnlock, addToast, t]);

  // Stable callback — uses functional updates so no dependency on password
  const handleKeyPress = useCallback(
    (key: string) => {
      if (key === "delete") {
        setPassword((prev) => prev.slice(0, -1));
      } else {
        setPassword((prev) => prev.length < 20 ? prev + key : prev);
      }
      setError("");
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (isLockedOut || isLoading || !password) return;

    setIsLoading(true);
    setError("");

    try {
      const success = await onUnlock(password);

      if (success) {
        setFailedAttempts(0);
        localStorage.removeItem("lockout");
      } else {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);
        setPassword("");
        setShake(true);
        setTimeout(() => setShake(false), 500);

        if (newAttempts >= maxAttempts) {
          const until = Date.now() + lockoutDurationMinutes * 60 * 1000;
          setLockoutUntil(until);
          localStorage.setItem(
            "lockout",
            JSON.stringify({ until, attempts: newAttempts })
          );
          setError(
            t('lock.lockedOut', { attempts: maxAttempts, minutes: lockoutDurationMinutes })
          );
        } else {
          const remaining = maxAttempts - newAttempts;
          setError(t('lock.wrongPin', { remaining }));
        }
      }
    } catch {
      setError(t('lock.errorOccurred'));
    } finally {
      setIsLoading(false);
    }
  }, [
    isLockedOut,
    isLoading,
    password,
    onUnlock,
    failedAttempts,
    maxAttempts,
    lockoutDurationMinutes,
    t,
  ]);

  // Auto-submit when password is long enough (e.g., 6 digits)
  useEffect(() => {
    if (password.length >= 6 && !isLoading && !isLockedOut) {
      handleSubmit();
    }
  }, [password, isLoading, isLockedOut, handleSubmit]);

  const formatSeconds = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const keypadDisabled = isLockedOut || isLoading;

  return (
    <div className="fixed inset-0 z-[100] bg-background text-foreground flex flex-col p-4 pt-safe pb-safe overflow-hidden overscroll-none">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Top Section */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <img src={zappiLogo} alt="" className="w-24 h-24 mb-6" aria-hidden="true" />

          <p className="text-foreground-muted text-body mb-8">
            {t('lock.enterPin')}
          </p>

          {/* PIN dots */}
          <div
            className="flex gap-3 mb-6"
            style={shake ? { animation: 'shake 0.4s ease-in-out' } : undefined}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all duration-150"
                style={{
                  transform: password.length > i ? 'scale(1)' : 'scale(0.75)',
                  backgroundColor: shake
                    ? 'color-mix(in srgb, var(--accent-danger) 50%, transparent)'
                    : password.length > i
                      ? 'var(--brand)'
                      : 'color-mix(in srgb, var(--brand) 20%, transparent)',
                  border: shake
                    ? '1px solid var(--accent-danger)'
                    : 'none',
                }}
              />
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="animate-fadeIn border-l-2 border-accent-danger bg-accent-danger/[0.06] px-3 py-2 text-caption text-accent-danger font-medium mb-3">
              {error}
            </div>
          )}

          {/* Lockout Message */}
          {isLockedOut && lockoutUntil && (
            <CountdownTimer expiryMs={lockoutUntil} onExpired={handleLockoutExpired}>
              {(remainingSeconds) => (
                <p className="text-accent-danger text-label text-center mt-1">
                  {t('lock.tryAgainIn', { time: formatSeconds(remainingSeconds) })}
                </p>
              )}
            </CountdownTimer>
          )}

          {/* Passkey Button */}
          {passkeyAvailable && !isLockedOut && (
            <button
              onClick={() => handlePasskeyAuth()}
              disabled={isLoading}
              className="mt-4 p-3 rounded-full bg-primary/5 hover:bg-primary/10 transition-all active:scale-95 disabled:opacity-50"
              aria-label={t('lock.faceIdUnlock')}
            >
              <FaceIdIcon />
            </button>
          )}
        </div>

        {/* Numeric Keypad — memoized, won't re-render on password changes */}
        <NumericKeypad
          onKeyPress={handleKeyPress}
          disabled={keypadDisabled}
          deleteAriaLabel={t('common.delete')}
        />
      </div>
    </div>
  );
}
