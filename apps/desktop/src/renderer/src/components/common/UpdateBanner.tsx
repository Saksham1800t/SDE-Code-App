import React, { useState } from 'react';
import { DownloadCloud, X } from 'lucide-react';
import { useUpdaterStore } from '../../store/updater';
import { Button } from './Button';
import './UpdateBanner.css';

/** Only surfaces once a downloaded update is ready to install — 'checking'/'downloading' stay silent background states, matching the non-intrusive update UX most desktop apps use. */
export const UpdateBanner: React.FC = () => {
  const { state, version } = useUpdaterStore();
  const [dismissed, setDismissed] = useState(false);

  if (state !== 'downloaded' || dismissed) return null;

  return (
    <div className="sde-update-banner">
      <DownloadCloud size={16} className="sde-update-banner-icon" />
      <div className="sde-update-banner-body">
        <div className="sde-update-banner-title">Update ready</div>
        <div className="sde-update-banner-message">
          {version ? `Version ${version} has been downloaded.` : 'A new version has been downloaded.'} Restart to install.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={() => window.api?.quitAndInstallUpdate?.()}>
        Restart
      </Button>
      <button className="sde-update-banner-close" onClick={() => setDismissed(true)} title="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
};
