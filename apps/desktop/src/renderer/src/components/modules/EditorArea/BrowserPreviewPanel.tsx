import React, { useEffect, useRef, useState } from 'react';
import './BrowserPreviewPanel.css';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink } from 'lucide-react';

interface BrowserPreviewPanelProps {
  url: string;
}

/** In-app browser tab, backed by a real Electron `<webview>` (requires webviewTag: true), isolated from this app's own renderer process. */
export const BrowserPreviewPanel: React.FC<BrowserPreviewPanelProps> = ({ url }) => {
  const webviewRef = useRef<SdeWebviewElement | null>(null);
  const [addressValue, setAddressValue] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return undefined;

    const updateNavState = () => {
      setCanGoBack(el.canGoBack());
      setCanGoForward(el.canGoForward());
    };
    const handleNavigate = () => {
      setAddressValue(el.getURL());
      updateNavState();
    };
    const handleStartLoading = () => setLoading(true);
    const handleStopLoading = () => {
      setLoading(false);
      updateNavState();
    };

    el.addEventListener('did-navigate', handleNavigate);
    el.addEventListener('did-navigate-in-page', handleNavigate);
    el.addEventListener('did-start-loading', handleStartLoading);
    el.addEventListener('did-stop-loading', handleStopLoading);

    return () => {
      el.removeEventListener('did-navigate', handleNavigate);
      el.removeEventListener('did-navigate-in-page', handleNavigate);
      el.removeEventListener('did-start-loading', handleStartLoading);
      el.removeEventListener('did-stop-loading', handleStopLoading);
    };
  }, []);

  const navigateTo = (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    webviewRef.current?.loadURL(normalized).catch(() => {});
  };

  return (
    <div className="sde-browser-preview">
      <div className="sde-browser-preview-toolbar">
        <button
          className="sde-icon-btn"
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="sde-icon-btn"
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button className="sde-icon-btn" onClick={() => webviewRef.current?.reload()} title="Reload">
          <RotateCw size={14} className={loading ? 'sde-browser-preview-spin' : ''} />
        </button>
        <input
          className="sde-browser-preview-address"
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigateTo(addressValue);
          }}
        />
        <button
          className="sde-icon-btn"
          onClick={() => window.api?.openExternal?.(addressValue)}
          title="Open in External Browser"
        >
          <ExternalLink size={14} />
        </button>
      </div>
      <webview ref={webviewRef} src={url} className="sde-browser-preview-webview" />
    </div>
  );
};
