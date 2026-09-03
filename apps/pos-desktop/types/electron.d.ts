declare module "electron" {
  interface WebPreferences {
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
    sandbox?: boolean;
    webSecurity?: boolean;
    allowRunningInsecureContent?: boolean;
    experimentalFeatures?: boolean;
    navigateOnDragDrop?: boolean;
    preload?: string;
  }

  interface BrowserWindowConstructorOptions {
    webPreferences?: WebPreferences;
    width?: number;
    height?: number;
    show?: boolean;
    titleBarStyle?: string;
  }

  interface WebContents {
    send(channel: string, ...args: unknown[]): void;
  }

  class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadFile(filePath: string): Promise<void>;
    loadURL(url: string): Promise<void>;
    readonly webContents: WebContents;
    on(event: "closed" | "ready-to-show", listener: () => void): this;
    show(): void;
    static getAllWindows(): BrowserWindow[];
    static fromWebContents(contents: WebContents): BrowserWindow | null;
  }

  interface App {
    whenReady(): Promise<void>;
    on(event: "window-all-closed" | "activate", listener: () => void): this;
    quit(): void;
    getPath(name: "userData" | "exe" | "home" | "appData"): string;
  }

  const app: App;

  interface IpcMainInvokeEvent {
    readonly sender: WebContents;
  }

  interface IpcMain {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown,
    ): void;
    removeHandler(channel: string): void;
  }

  const ipcMain: IpcMain;

  interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  }

  const ipcRenderer: IpcRenderer;

  interface ContextBridge {
    exposeInMainWorld(apiKey: string, api: Record<string, unknown>): void;
  }

  const contextBridge: ContextBridge;
}
