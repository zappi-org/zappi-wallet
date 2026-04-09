import { useState, useEffect, useCallback } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean; // 오프라인이었다가 온라인으로 전환됨
}

/**
 * 전역 네트워크 상태 훅
 * - navigator.onLine + online/offline 이벤트 리스너
 * - 온라인 전환 시 wasOffline 플래그로 동기화 트리거 가능
 */
export function useNetworkStatus(): NetworkStatus & {
  resetWasOffline: () => void;
} {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);

  const resetWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[Network] Online');
      // 오프라인이었다가 온라인으로 전환됨
      if (!isOnline) {
        setWasOffline(true);
      }
      setIsOnline(true);
    };

    const handleOffline = () => {
      console.log('[Network] Offline');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline]);

  return { isOnline, wasOffline, resetWasOffline };
}

/**
 * 네트워크 상태를 앱 전역에서 공유하기 위한 스토어
 * Zustand 없이 간단한 이벤트 기반 구현
 */
type NetworkListener = (isOnline: boolean) => void;
const listeners = new Set<NetworkListener>();

// 초기화 - 한 번만 실행
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    listeners.forEach((listener) => listener(true));
  });
  window.addEventListener('offline', () => {
    listeners.forEach((listener) => listener(false));
  });
}

export function subscribeNetworkStatus(listener: NetworkListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
