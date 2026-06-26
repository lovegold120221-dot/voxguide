export const APP_VERSION = '1.0.2';
export const APP_BUILD = 1;

export const VERSION_KEY = 'beatrice_app_version';

export function getInstalledVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch {
    return null;
  }
}

export function setInstalledVersion(version: string): void {
  try {
    localStorage.setItem(VERSION_KEY, version);
  } catch {}
}

export function isUpdateAvailable(): boolean {
  const installed = getInstalledVersion();
  return installed !== null && installed !== APP_VERSION;
}

export function needsInitialInstall(): boolean {
  return getInstalledVersion() === null;
}
