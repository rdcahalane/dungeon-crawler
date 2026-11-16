/**
 * True inside the app-store builds (Capacitor's iOS or Android shell), false in any browser.
 * The app bundles the game with no server, so saves stay on the device and there is no sign-in.
 */
export function isNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}
