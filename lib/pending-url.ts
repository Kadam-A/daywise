/**
 * Pending URL store
 *
 * On Android, deep-link URL events fire before the auth/callback screen
 * mounts and registers its own Linking listener. This module captures
 * those URLs at the root layout level so auth/callback can consume them.
 */

let _pendingUrl: string | null = null;

export function setPendingUrl(url: string): void {
  _pendingUrl = url;
}

/** Returns and clears the stored URL (consume-once). */
export function takePendingUrl(): string | null {
  const url = _pendingUrl;
  _pendingUrl = null;
  return url;
}
