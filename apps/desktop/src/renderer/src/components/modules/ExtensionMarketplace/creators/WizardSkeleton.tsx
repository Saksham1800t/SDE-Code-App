import React, { useState } from 'react';
import '../ExtensionMarketplace.css';
import { Button } from '../../../common/Button';
import { AlertBanner } from '../../../common/AlertBanner';

interface WizardStep {
  title: string;
  renderForm: () => React.ReactNode;
}

interface WizardSkeletonProps {
  steps: WizardStep[];
  activeStep: number;
  setActiveStep: (step: number) => void;
  onBack?: () => void;
  onNext?: () => void;
  onPublish: () => void;
  publishing: boolean;
  errorMsg: string;
  setErrorMsg: (msg: string) => void;
  previewTitle: string;
  renderPreview: () => React.ReactNode;
  renderCode: () => React.ReactNode;
}

export const WizardSkeleton: React.FC<WizardSkeletonProps> = ({
  steps,
  activeStep,
  setActiveStep,
  onBack,
  onNext,
  onPublish,
  publishing,
  errorMsg,
  setErrorMsg,
  previewTitle,
  renderPreview,
  renderCode,
}) => {
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'code'>('preview');

  return (
    <div className="sde-wizard">
      <div className="sde-wizard-left">
        {errorMsg && (
          <AlertBanner
            type="error"
            message={errorMsg}
            onClose={() => setErrorMsg('')}
            style={{ marginBottom: '16px' }}
          />
        )}

        <div className="sde-wizard-header">
          <div className="sde-wizard-step-info">
            <span className="sde-wizard-step-sub">
              STEP {activeStep} OF {steps.length}
            </span>
            <h2 className="sde-wizard-step-title">
              {steps[activeStep - 1]?.title}
            </h2>
          </div>

          <div className="sde-wizard-stepper-dots">
            {steps.map((_, idx) => {
              const s = idx + 1;
              const active = activeStep === s;
              return (
                <div
                  key={s}
                  onClick={() => setActiveStep(s)}
                  className={`sde-wizard-stepper-dot${active ? ' sde-wizard-stepper-dot--active' : ''}`}
                />
              );
            })}
          </div>
        </div>

        <div className="sde-wizard-content">
          {steps[activeStep - 1]?.renderForm()}
        </div>

        <div className="sde-wizard-actions">
          <Button
            onClick={() => {
              if (onBack) onBack();
              setActiveStep(Math.max(1, activeStep - 1));
            }}
            disabled={activeStep === 1}
            variant="secondary"
            size="sm"
          >
            Back
          </Button>

          <Button
            onClick={() => {
              if (activeStep < steps.length) {
                if (onNext) onNext();
                setActiveStep(activeStep + 1);
              } else {
                onPublish();
              }
            }}
            variant="primary"
            size="sm"
            style={{ minWidth: '80px' }}
            disabled={publishing}
          >
            {activeStep === steps.length ? 'Publish' : 'Next'}
          </Button>
        </div>
      </div>

      <div className="sde-wizard-right">
        <div className="sde-wizard-right-tabs">
          <button
            onClick={() => setRightPanelTab('preview')}
            className={`sde-wizard-right-tab-btn${rightPanelTab === 'preview' ? ' sde-wizard-right-tab-btn--active' : ''}`}
          >
            {previewTitle}
          </button>
          <button
            onClick={() => setRightPanelTab('code')}
            className={`sde-wizard-right-tab-btn${rightPanelTab === 'code' ? ' sde-wizard-right-tab-btn--active' : ''}`}
          >
            Generated Files
          </button>
        </div>

        <div className="sde-wizard-right-body">
          {rightPanelTab === 'preview' ? renderPreview() : renderCode()}
        </div>
      </div>
    </div>
  );
};
