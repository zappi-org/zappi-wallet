import { useState, useCallback, useEffect } from "react";
import { Lock, Delete } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CountdownTimer } from "@/ui/components/common";
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
    className={className || "w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8"}
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
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [shake, setShake] = useState(false);

  // Check passkey availability
  useEffect(() => {
    const checkPasskey = () => {
      const available = isPasskeySupported() && isPasskeyRegistered();
      setPasskeyAvailable(available);
    };
    checkPasskey();
  }, []);

  // Auto-trigger passkey on mount if available
  useEffect(() => {
    if (passkeyAvailable && !isLoading) {
      handlePasskeyAuth();
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

  const handlePasskeyAuth = useCallback(async () => {
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
      // Passkey failed silently
    } finally {
      setIsLoading(false);
    }
  }, [isLockedOut, isLoading, onUnlock]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (isLockedOut || isLoading) return;

      if (key === "delete") {
        setPassword((prev) => prev.slice(0, -1));
      } else {
        setPassword((prev) => prev.length < 20 ? prev + key : prev);
      }
      setError((prev) => prev ? "" : prev);
    },
    [isLockedOut, isLoading]
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

  return (
    <div className="fixed inset-0 z-[100] bg-primary text-primary-foreground flex flex-col items-center p-3 pt-safe pb-safe">
      {/* Background Ambient - simple gradient, no blur */}
      <div className="absolute inset-0 bg-gradient-to-bl from-accent-primary/20 to-transparent pointer-events-none" />

      {/* Top Section - uses flex-1 to take remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 min-h-0">
        <div className="w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20 bg-background/10 rounded-full flex items-center justify-center mb-3 sm:mb-4 md:mb-5 ring-1 ring-background/20">
          <Lock className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-primary-foreground" />
        </div>

        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-1 sm:mb-1.5">
          {t('lock.welcomeBack')}
        </h2>
        <p className="text-primary-foreground/60 text-xs sm:text-sm">
          {t('lock.enterPin')}
        </p>

        {/* Password Dots */}
        <div
          className="flex gap-3 sm:gap-3.5 md:gap-4 mt-6 sm:mt-7 md:mt-8"
          style={shake ? { animation: 'shake 0.4s ease-in-out' } : undefined}
        >
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="w-3 h-3 sm:w-3.5 sm:h-3.5 md:w-4 md:h-4 rounded-full"
              style={{
                backgroundColor: shake
                  ? 'rgba(248, 113, 113, 0.5)'
                  : password.length > i
                    ? '#e4e0d5'
                    : 'transparent',
                border: shake
                  ? '1px solid #f87171'
                  : password.length > i
                    ? '1px solid #e4e0d5'
                    : '1px solid rgba(228, 224, 213, 0.3)',
                transform: password.length > i ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-red-400 text-xs sm:text-sm mt-2 sm:mt-3 font-bold animate-pulse">
            {error}
          </p>
        )}

        {/* Lockout Message */}
        {isLockedOut && lockoutUntil && (
          <CountdownTimer expiryMs={lockoutUntil} onExpired={handleLockoutExpired}>
            {(remainingSeconds) => (
              <p className="text-red-400 text-xs sm:text-sm text-center mt-1 sm:mt-1.5">
                {t('lock.tryAgainIn', { time: formatSeconds(remainingSeconds) })}
              </p>
            )}
          </CountdownTimer>
        )}

        {/* Passkey Button */}
        {passkeyAvailable && !isLockedOut && (
          <button
            onClick={handlePasskeyAuth}
            disabled={isLoading}
            className="mt-4 sm:mt-5 md:mt-6 p-3 sm:p-3.5 md:p-4 rounded-full bg-background/10 hover:bg-background/20 transition-all active:scale-95 disabled:opacity-50"
            aria-label={t('lock.faceIdUnlock')}
          >
            <FaceIdIcon />
          </button>
        )}
      </div>

      {/* Keypad - fixed height */}
      <div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:gap-x-5 sm:gap-y-3 md:gap-x-6 md:gap-y-4 pb-3 sm:pb-4 relative z-10 shrink-0">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onPointerDown={(e) => { e.preventDefault(); handleKeyPress(num.toString()) }}
            disabled={isLockedOut || isLoading}
            className="w-[72px] h-[72px] sm:w-[78px] sm:h-[78px] md:w-[84px] md:h-[84px] rounded-full text-2xl sm:text-3xl md:text-4xl font-medium text-primary-foreground hover:bg-background/10 active:bg-background/20 flex items-center justify-center mx-auto disabled:opacity-50 touch-manipulation"
          >
            {num}
          </button>
        ))}
        <div />
        <button
          onPointerDown={(e) => { e.preventDefault(); handleKeyPress("0") }}
          disabled={isLockedOut || isLoading}
          className="w-[72px] h-[72px] sm:w-[78px] sm:h-[78px] md:w-[84px] md:h-[84px] rounded-full text-2xl sm:text-3xl md:text-4xl font-medium text-primary-foreground hover:bg-background/10 active:bg-background/20 flex items-center justify-center mx-auto disabled:opacity-50 touch-manipulation"
        >
          0
        </button>
        <button
          onPointerDown={(e) => { e.preventDefault(); handleKeyPress("delete") }}
          disabled={isLockedOut || isLoading}
          aria-label={t('common.delete')}
          className="w-[72px] h-[72px] sm:w-[78px] sm:h-[78px] md:w-[84px] md:h-[84px] rounded-full text-primary-foreground hover:bg-background/10 active:bg-background/20 flex items-center justify-center mx-auto disabled:opacity-50 touch-manipulation"
        >
          <Delete className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8" />
        </button>
      </div>
    </div>
  );
}
