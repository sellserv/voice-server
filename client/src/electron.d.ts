interface ElectronAPI {
  // Window controls
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;

  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  // Settings store
  storeGet: (key: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown) => Promise<void>;

  // Autostart
  isAutoStartEnabled: () => Promise<boolean>;
  setAutoStart: (enabled: boolean) => Promise<void>;

  // Idle detection
  getIdleSeconds: () => Promise<number>;

  // Notifications
  notify: (title: string, body: string) => Promise<void>;

  // Shell
  openExternal: (url: string) => Promise<void>;

  // Updater
  checkForUpdates: () => Promise<{ available: boolean; version?: string }>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
