/** Minimal ambient declaration of Electron.WebviewTag (whose real types live in the main-process-only `electron` package the renderer doesn't reference), covering only what BrowserPreviewPanel.tsx calls. The trailing `export {}` makes this a module so `declare global` is legal, keeping SdeWebviewElement globally visible. */
declare global {
  interface SdeWebviewElement extends HTMLElement {
    src: string;
    loadURL(url: string): Promise<void>;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<SdeWebviewElement>, SdeWebviewElement> & {
        src?: string;
        allowpopups?: string;
      };
    }
  }
}

export {};
