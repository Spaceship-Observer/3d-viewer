/**
 * PWA: регистрация service worker, обновления и установка на домашний экран.
 * В dev-режиме плагин отдаёт no-op, поэтому ошибки глушим молча.
 */
export function registerPWA({ onUpdate, onOffline, onOnline, onInstalled } = {}) {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('online', () => onOnline?.());
  window.addEventListener('offline', () => onOffline?.());

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          onUpdate?.(() => updateSW(true));
        },
        onOfflineReady() {
          onOffline?.();
        },
      });
      // Тихая проверка раз в час — чтобы фоновая правка подхватилась сама
      setInterval(() => updateSW?.(true), 60 * 60 * 1000);
    })
    .catch((e) => console.warn('SW не зарегистрирован:', e));

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    onInstalled?.(async () => {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      return outcome === 'accepted';
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
