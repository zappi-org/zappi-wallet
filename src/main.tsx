import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n' // Initialize i18n
import './registerSW' // PWA service worker registration & auto-update
import App from './App.tsx'
import { PWAInstallGuard } from './components/PWAInstallGuard'
import { ErrorBoundary } from './ui/components/ErrorBoundary'

// Check storage availability (localStorage + IndexedDB)
function checkStorageAvailability(): boolean {
  try {
    // Check localStorage
    localStorage.setItem('__storage_test__', 'test');
    localStorage.removeItem('__storage_test__');

    // Check IndexedDB
    if (!window.indexedDB) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Render storage blocked screen
function renderStorageBlocked() {
  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; background: #F8F9FC; color: #1D1D1F; font-family: 'Outfit', system-ui, sans-serif;">
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">Storage Unavailable</h1>
      <p style="color: #86868B; max-width: 320px; line-height: 1.5;">
        This app cannot access local storage.<br/>
        Please enable cookies/storage in your browser settings.
      </p>
      <p style="color: #A0A3AD; font-size: 14px; margin-top: 16px;">
        Usage may be limited in incognito/private mode.
      </p>
    </div>
  `;
}

if (!checkStorageAvailability()) {
  renderStorageBlocked();
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <PWAInstallGuard>
          <App />
        </PWAInstallGuard>
      </ErrorBoundary>
    </StrictMode>,
  )
}
