import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Detect if running as installed PWA
function isPWA(): boolean {
  // 1. Check URL parameter from manifest start_url (most reliable method)
  // When PWA is installed and launched, it uses start_url from manifest
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'standalone') {
    return true;
  }

  // 2. Check display-mode: standalone (works for most browsers)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  // 3. Check display-mode: fullscreen
  if (window.matchMedia('(display-mode: fullscreen)').matches) {
    return true;
  }

  // 4. Check display-mode: minimal-ui
  if (window.matchMedia('(display-mode: minimal-ui)').matches) {
    return true;
  }

  // 5. Check iOS Safari standalone mode
  if ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true) {
    return true;
  }

  // 6. Check if running in TWA (Trusted Web Activity) on Android
  if (document.referrer.includes('android-app://')) {
    return true;
  }

  return false;
}

// Detect platform
function getPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) {
    return 'ios';
  }

  if (/android/.test(ua)) {
    return 'android';
  }

  return 'desktop';
}

interface PWAInstallGuardProps {
  children: React.ReactNode;
}

export function PWAInstallGuard({ children }: PWAInstallGuardProps) {
  const [isInstalled, setIsInstalled] = useState(() => isPWA());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform] = useState(() => getPlatform());

  useEffect(() => {
    // Listen for display-mode changes (in case user installs while on page)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    // Capture install prompt for Chrome/Edge
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Handle native install prompt
  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  // Already installed as PWA - render app
  if (isInstalled) {
    return <>{children}</>;
  }

  // Not installed - show install guide (cashu.me style)
  return (
    <div className="min-h-dvh bg-black text-white flex flex-col">
      {/* Main Content - Centered */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-sm w-full space-y-8">
          {/* Logo */}
          <div className="space-y-3">
            <div className="text-5xl font-bold tracking-tighter">ZAPPI</div>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <p className="text-lg font-medium">앱 설치 필요</p>
            <p className="text-zinc-400 text-sm leading-relaxed">
              오프라인 결제, 안정적인 데이터 저장을 위해<br/>
              홈 화면에 앱을 설치해주세요
            </p>
          </div>

          {/* Install Button (Chrome/Edge) */}
          {deferredPrompt && (
            <button
              onClick={handleInstall}
              className="w-full py-4 bg-white text-black font-semibold rounded-xl
                         hover:bg-zinc-200 active:scale-[0.98] transition-all"
            >
              앱 설치하기
            </button>
          )}

          {/* Platform-specific inline instructions */}
          {platform === 'ios' && <IOSInlineGuide />}
          {platform === 'android' && !deferredPrompt && <AndroidInlineGuide />}
          {platform === 'desktop' && !deferredPrompt && <DesktopInlineGuide />}

          {/* Bypass button (dev mode or ?bypass=true query param) */}
          {(import.meta.env.DEV || window.location.search.includes('bypass=true')) && (
            <button
              onClick={() => setIsInstalled(true)}
              className="text-xs text-zinc-600 hover:text-zinc-400 underline"
            >
              설치 없이 진입 (테스트용)
            </button>
          )}
        </div>
      </div>

      {/* Platform-specific floating prompt - cashu.me style */}
      {platform === 'ios' && <IOSPrompt />}
      {platform === 'android' && !deferredPrompt && <AndroidPrompt />}
      {platform === 'desktop' && !deferredPrompt && <DesktopPrompt />}
    </div>
  );
}

// iOS Prompt (bottom, pointing to share button) - cashu.me style
function IOSPrompt() {
  return (
    <div className="fixed bottom-8 left-4 right-4 z-50 animate-bounce-slow">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 relative">
        <div className="flex items-start gap-3">
          <div className="text-2xl">📤</div>
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">Safari에서 설치</p>
            <p className="text-zinc-400 text-xs mt-1">
              하단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-[10px]">공유 ↑</span> 버튼 →
              <span className="font-medium text-white"> 홈 화면에 추가</span>
            </p>
          </div>
        </div>
        {/* Arrow pointing down */}
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
          <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[12px] border-t-zinc-700" />
        </div>
      </div>
    </div>
  );
}

// Android Prompt (top, pointing to menu) - cashu.me style
function AndroidPrompt() {
  return (
    <div className="fixed top-4 right-4 left-4 z-50 animate-bounce-slow">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 relative">
        {/* Arrow pointing up */}
        <div className="absolute -top-3 right-6">
          <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[12px] border-b-zinc-700" />
        </div>
        <div className="flex items-start gap-3">
          <div className="text-2xl">⋮</div>
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">Chrome에서 설치</p>
            <p className="text-zinc-400 text-xs mt-1">
              우측 상단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-[10px]">⋮</span> 메뉴 →
              <span className="font-medium text-white"> 앱 설치</span> 또는 <span className="font-medium text-white">홈 화면에 추가</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Desktop Prompt (top-right, pointing to browser menu) - cashu.me style
function DesktopPrompt() {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isMac = /mac/i.test(navigator.userAgent);
  const isEdge = /edg/i.test(navigator.userAgent);

  return (
    <div className="fixed top-4 right-4 z-50 animate-bounce-slow">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 relative max-w-xs">
        {/* Arrow pointing up-right */}
        <div className="absolute -top-3 right-8">
          <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[12px] border-b-zinc-700" />
        </div>
        <div className="flex items-start gap-3">
          <div className="text-2xl">{isSafari && isMac ? '📤' : '⋮'}</div>
          <div className="flex-1 text-left">
            {isSafari && isMac ? (
              <>
                <p className="font-medium text-sm">Safari에서 설치</p>
                <p className="text-zinc-400 text-xs mt-1">
                  <span className="font-medium text-white">파일</span> 메뉴 →
                  <span className="font-medium text-white"> Dock에 추가</span>
                  <br />또는 <span className="font-medium text-white">공유</span> 버튼 → <span className="font-medium text-white">Dock에 추가</span>
                </p>
              </>
            ) : isEdge ? (
              <>
                <p className="font-medium text-sm">Edge에서 설치</p>
                <p className="text-zinc-400 text-xs mt-1">
                  <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-[10px]">···</span> 메뉴 →
                  <span className="font-medium text-white"> 앱</span> →
                  <span className="font-medium text-white"> 앱으로 설치</span>
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-sm">Chrome에서 설치</p>
                <p className="text-zinc-400 text-xs mt-1">
                  <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-[10px]">⋮</span> 메뉴 →
                  <span className="font-medium text-white"> 저장 및 공유</span> →
                  <span className="font-medium text-white"> 페이지를 앱으로 설치</span>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline Guides (shown in main content area)
function IOSInlineGuide() {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left">
      <p className="font-medium text-sm mb-3 text-center">Safari에서 설치하기</p>
      <ol className="space-y-2 text-sm text-zinc-400">
        <li className="flex gap-2">
          <span className="text-white">1.</span>
          <span>하단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-xs text-white">공유 ↑</span> 버튼 탭</span>
        </li>
        <li className="flex gap-2">
          <span className="text-white">2.</span>
          <span><span className="text-white">홈 화면에 추가</span> 선택</span>
        </li>
        <li className="flex gap-2">
          <span className="text-white">3.</span>
          <span>우측 상단 <span className="text-white">추가</span> 탭</span>
        </li>
      </ol>
    </div>
  );
}

function AndroidInlineGuide() {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left">
      <p className="font-medium text-sm mb-3 text-center">Chrome에서 설치하기</p>
      <ol className="space-y-2 text-sm text-zinc-400">
        <li className="flex gap-2">
          <span className="text-white">1.</span>
          <span>우측 상단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-xs text-white">⋮</span> 메뉴 탭</span>
        </li>
        <li className="flex gap-2">
          <span className="text-white">2.</span>
          <span><span className="text-white">앱 설치</span> 또는 <span className="text-white">홈 화면에 추가</span> 선택</span>
        </li>
      </ol>
    </div>
  );
}

function DesktopInlineGuide() {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isMac = /mac/i.test(navigator.userAgent);
  const isEdge = /edg/i.test(navigator.userAgent);

  if (isSafari && isMac) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left">
        <p className="font-medium text-sm mb-3 text-center">Safari에서 설치하기</p>
        <ol className="space-y-2 text-sm text-zinc-400">
          <li className="flex gap-2">
            <span className="text-white">1.</span>
            <span>상단 메뉴바에서 <span className="text-white">파일</span> 클릭</span>
          </li>
          <li className="flex gap-2">
            <span className="text-white">2.</span>
            <span><span className="text-white">Dock에 추가...</span> 선택</span>
          </li>
        </ol>
        <p className="text-xs text-zinc-500 mt-3 text-center">
          또는 공유 버튼 → Dock에 추가
        </p>
        <p className="text-xs text-zinc-500 mt-1 text-center">
          macOS Sonoma (14) 이상 필요
        </p>
      </div>
    );
  }

  if (isEdge) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left">
        <p className="font-medium text-sm mb-3 text-center">Edge에서 설치하기</p>
        <ol className="space-y-2 text-sm text-zinc-400">
          <li className="flex gap-2">
            <span className="text-white">1.</span>
            <span>우측 상단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-xs text-white">···</span> 메뉴 클릭</span>
          </li>
          <li className="flex gap-2">
            <span className="text-white">2.</span>
            <span><span className="text-white">앱</span> → <span className="text-white">이 사이트를 앱으로 설치</span></span>
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-left">
      <p className="font-medium text-sm mb-3 text-center">Chrome에서 설치하기</p>
      <ol className="space-y-2 text-sm text-zinc-400">
        <li className="flex gap-2">
          <span className="text-white">1.</span>
          <span>우측 상단 <span className="inline-block px-1.5 py-0.5 bg-zinc-800 rounded text-xs text-white">⋮</span> 메뉴 클릭</span>
        </li>
        <li className="flex gap-2">
          <span className="text-white">2.</span>
          <span><span className="text-white">저장 및 공유</span> → <span className="text-white">페이지를 앱으로 설치</span></span>
        </li>
      </ol>
      <p className="text-xs text-zinc-500 mt-3 text-center">
        또는 주소창 오른쪽 설치 아이콘 클릭
      </p>
    </div>
  );
}
