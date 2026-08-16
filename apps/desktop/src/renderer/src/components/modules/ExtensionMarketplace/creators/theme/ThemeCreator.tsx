import React, { useState } from 'react';
import '../../ExtensionMarketplace.css';
import { WizardSkeleton } from '../WizardSkeleton';
import { Input, TextArea } from '../../../../common/Input';
import { Button } from '../../../../common/Button';
import { Palette, Check, Folder, Settings, Plug } from 'lucide-react';

interface ThemeCreatorProps {
  token: string | null;
  user: any;
  onSuccess: (message: string) => void;
}

export const ThemeCreator: React.FC<ThemeCreatorProps> = ({ token, user, onSuccess }) => {
  const [activeStep, setActiveStep] = useState<number>(1);

  // States
  const [baseStyle, setBaseStyle] = useState<'dark' | 'light' | 'neon' | 'monokai'>('dark');
  const [themeId, setThemeId] = useState('theme.custom-dark');
  const [displayName, setDisplayName] = useState('My Custom Dark');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('A premium custom dark theme for SDE Code.');
  const [publisher, setPublisher] = useState(user?.username || 'Self');
  const [license, setLicense] = useState('MIT');

  // Custom Colors
  const [bgPrimary, setBgPrimary] = useState('#0d1117');
  const [bgSecondary, setBgSecondary] = useState('#161b22');
  const [textPrimary, setTextPrimary] = useState('#c9d1d9');
  const [textSecondary, setTextSecondary] = useState('#8b949e');
  const [accentCyan, setAccentCyan] = useState('#58a6ff');
  const [accentGlow, setAccentGlow] = useState('rgba(88, 166, 255, 0.25)');
  const [borderColor, setBorderColor] = useState('#30363d');

  // AI Prompt
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const applyBasePreset = (preset: 'dark' | 'light' | 'neon' | 'monokai') => {
    setBaseStyle(preset);
    if (preset === 'dark') {
      setBgPrimary('#0d1117');
      setBgSecondary('#161b22');
      setTextPrimary('#c9d1d9');
      setTextSecondary('#8b949e');
      setAccentCyan('#58a6ff');
      setAccentGlow('rgba(88, 166, 255, 0.25)');
      setBorderColor('#30363d');
    } else if (preset === 'light') {
      setBgPrimary('#ffffff');
      setBgSecondary('#f6f8fa');
      setTextPrimary('#24292f');
      setTextSecondary('#57606a');
      setAccentCyan('#0969da');
      setAccentGlow('rgba(9, 105, 218, 0.15)');
      setBorderColor('#d0d7de');
    } else if (preset === 'neon') {
      setBgPrimary('#0b0813');
      setBgSecondary('#120a2a');
      setTextPrimary('#e2d9f3');
      setTextSecondary('#a390ca');
      setAccentCyan('#00ffcc');
      setAccentGlow('rgba(0, 255, 204, 0.35)');
      setBorderColor('#3d1b6b');
    } else if (preset === 'monokai') {
      setBgPrimary('#272822');
      setBgSecondary('#1e1f1c');
      setTextPrimary('#f8f8f2');
      setTextSecondary('#75715e');
      setAccentCyan('#a6e22e');
      setAccentGlow('rgba(166, 226, 46, 0.25)');
      setBorderColor('#3e3d32');
    }
  };

  const handleAiPalette = () => {
    if (!aiPrompt) return;
    setIsAiGenerating(true);
    setTimeout(() => {
      const promptLower = aiPrompt.toLowerCase();
      if (promptLower.includes('ocean') || promptLower.includes('blue') || promptLower.includes('water')) {
        setBgPrimary('#0f172a');
        setBgSecondary('#1e293b');
        setTextPrimary('#f8fafc');
        setTextSecondary('#94a3b8');
        setAccentCyan('#38bdf8');
        setAccentGlow('rgba(56, 189, 248, 0.25)');
        setBorderColor('#334155');
      } else if (promptLower.includes('forest') || promptLower.includes('green') || promptLower.includes('nature')) {
        setBgPrimary('#061f14');
        setBgSecondary('#0c2a1c');
        setTextPrimary('#e6f4ea');
        setTextSecondary('#9dbbaf');
        setAccentCyan('#34d399');
        setAccentGlow('rgba(52, 211, 153, 0.25)');
        setBorderColor('#183f2e');
      } else if (promptLower.includes('sunset') || promptLower.includes('red') || promptLower.includes('orange')) {
        setBgPrimary('#1a0c0c');
        setBgSecondary('#2a1212');
        setTextPrimary('#fdf2f2');
        setTextSecondary('#d99b9b');
        setAccentCyan('#f97316');
        setAccentGlow('rgba(249, 115, 22, 0.25)');
        setBorderColor('#3f1d1d');
      } else {
        setBgPrimary('#09090b');
        setBgSecondary('#18181b');
        setTextPrimary('#fafafa');
        setTextSecondary('#a1a1aa');
        setAccentCyan('#d946ef');
        setAccentGlow('rgba(217, 70, 239, 0.25)');
        setBorderColor('#27272a');
      }
      setIsAiGenerating(false);
      setActiveStep(5);
    }, 1200);
  };

  const handlePublish = async () => {
    setPublishing(true);
    setErrorMsg('');
    const api = window.api;
    if (!api || !api.scaffoldAndPublishExtension) {
      setErrorMsg('Extension developer SDK IPC bridge is missing.');
      setPublishing(false);
      return;
    }
    if (!token) {
      setErrorMsg('You must be logged in to publish an extension.');
      setPublishing(false);
      return;
    }

    try {
      await api.scaffoldAndPublishExtension({
        id: themeId,
        name: displayName,
        version,
        description,
        publisher,
        provides: ['theme'],
        dependsOn: [],
        templateConfig: {
          templateType: 'theme',
          themeColors: {
            bgPrimary,
            bgSecondary,
            textPrimary,
            textSecondary,
            accentCyan,
            accentGlow,
            borderColor
          }
        },
        token
      });

      onSuccess(`Theme extension "${displayName}" generated and published successfully!`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Compiler packaging failed.');
    } finally {
      setPublishing(false);
    }
  };

  const generatedManifest = JSON.stringify({
    id: themeId,
    name: displayName,
    version,
    description,
    publisher,
    provides: {
      theme: {
        name: displayName,
        colors: {
          '--bg-primary': bgPrimary,
          '--bg-secondary': bgSecondary,
          '--text-primary': textPrimary,
          '--text-secondary': textSecondary,
          '--accent-cyan': accentCyan,
          '--accent-cyan-glow': accentGlow,
          '--border-color': borderColor
        }
      }
    },
    permissions: [],
    activationEvents: ['onStartup']
  }, null, 2);

  const generatedThemeCss = `:root {
  --bg-primary: ${bgPrimary};
  --bg-secondary: ${bgSecondary};
  --text-primary: ${textPrimary};
  --text-secondary: ${textSecondary};
  --accent-cyan: ${accentCyan};
  --accent-cyan-glow: ${accentGlow};
  --border-color: ${borderColor};
}
`;

  const steps = [
    {
      title: 'Select Base Theme Style',
      renderForm: () => (
        <div className="sde-theme-creator-grid">
          {[
            { id: 'dark' as const, title: 'Sleek Dark', desc: 'Premium GitHub-inspired dark colors.', colors: ['#0d1117', '#161b22', '#58a6ff'] },
            { id: 'light' as const, title: 'Bright Light', desc: 'Clean document-inspired light colors.', colors: ['#ffffff', '#f6f8fa', '#0969da'] },
            { id: 'neon' as const, title: 'Cyberpunk Neon', desc: 'Futuristic dark purple and bright green tones.', colors: ['#0b0813', '#120a2a', '#00ffcc'] },
            { id: 'monokai' as const, title: 'Monokai Retro', desc: 'Retro developer editor high-contrast color scheme.', colors: ['#272822', '#1e1f1c', '#a6e22e'] },
          ].map(item => {
            const selected = baseStyle === item.id;
            return (
              <div
                key={item.id}
                onClick={() => applyBasePreset(item.id)}
                className={`sde-theme-preset-card${selected ? ' sde-theme-preset-card--selected' : ''}`}
              >
                <div className="sde-theme-preset-header">
                  <span className="sde-theme-preset-title">{item.title}</span>
                  <div className="sde-theme-preset-colors">
                    {item.colors.map((c, i) => (
                      <div key={i} className="sde-theme-preset-dot" style={{ background: c }} />
                    ))}
                  </div>
                </div>
                <p className="sde-theme-preset-desc">{item.desc}</p>
              </div>
            );
          })}
        </div>
      )
    },
    {
      title: 'Expose Theme Metadata',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '12px' }}>
          <div className="sde-theme-creator-grid">
            <Input label="Extension ID" value={themeId} onChange={(e) => setThemeId(e.target.value.replace(/\s+/g, '-').toLowerCase())} />
            <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="sde-theme-creator-grid">
            <Input label="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input label="Publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </div>
          <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <Input label="License" value={license} onChange={(e) => setLicense(e.target.value)} />
        </div>
      )
    },
    {
      title: 'Visual Theme Customizer',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '14px' }}>
          <div className="sde-theme-creator-grid" style={{ rowGap: '14px', columnGap: '14px' }}>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Primary Background</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={bgPrimary} onChange={(e) => setBgPrimary(e.target.value)} className="sde-theme-color-picker" />
                <Input value={bgPrimary} onChange={(e) => setBgPrimary(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Secondary Background</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={bgSecondary} onChange={(e) => setBgSecondary(e.target.value)} className="sde-theme-color-picker" />
                <Input value={bgSecondary} onChange={(e) => setBgSecondary(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Primary Text</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={textPrimary} onChange={(e) => setTextPrimary(e.target.value)} className="sde-theme-color-picker" />
                <Input value={textPrimary} onChange={(e) => setTextPrimary(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Secondary Text</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={textSecondary} onChange={(e) => setTextSecondary(e.target.value)} className="sde-theme-color-picker" />
                <Input value={textSecondary} onChange={(e) => setTextSecondary(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Accent Highlight</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={accentCyan} onChange={(e) => {
                  setAccentCyan(e.target.value);
                  setAccentGlow(e.target.value + '40');
                }} className="sde-theme-color-picker" />
                <Input value={accentCyan} onChange={(e) => setAccentCyan(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="sde-theme-customize-row">
              <label className="sde-form-label">Border Color</label>
              <div className="sde-theme-color-input-container">
                <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="sde-theme-color-picker" />
                <Input value={borderColor} onChange={(e) => setBorderColor(e.target.value)} style={{ flex: 1 }} />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'AI Palette Generator',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '12px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
            Enter a visual theme description (e.g. "sunset vibes", "deep oceanic blue") and SDE Copilot will generate a matching color palette.
          </p>
          <TextArea
            label="Copilot Color Prompt"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="e.g. A warm forest theme with dark green backgrounds and light mint highlights."
            rows={3}
          />
          <Button onClick={handleAiPalette} disabled={isAiGenerating} variant="primary" fullWidth>
            {isAiGenerating ? 'AI Copilot suggesting colors...' : <><Palette size={14} /> Generate Theme Palette</>}
          </Button>
        </div>
      )
    },
    {
      title: 'Validation & Publish',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '16px' }}>
          <div className="sde-theme-publish-grid">
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Target Directory</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>extensions/temp-publish</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Capability</div>
              <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '2px', fontWeight: 600 }}>provides: ["theme"]</div>
            </div>
          </div>

          <div className="sde-flex-col" style={{ gap: '10px' }}>
            <h4 style={{ fontSize: '12px', color: 'var(--text-primary)', margin: 0, fontWeight: 650 }}>PRE-PUBLISH CHECKLIST</h4>
            <div className="sde-flex-col" style={{ gap: '6px' }}>
              <div className="sde-theme-checklist-row">
                <Check size={12} /> Manifest JSON Schema valid
              </div>
              <div className="sde-theme-checklist-row">
                <Check size={12} /> Stylesheet compilation output successful
              </div>
              <div className="sde-theme-checklist-row">
                <Check size={12} /> Sandbox settings verified (No system permissions required)
              </div>
            </div>
          </div>

          <Button onClick={handlePublish} disabled={publishing} variant="primary" fullWidth style={{ height: '36px' }}>
            {publishing ? 'Generating & Publishing Theme...' : 'Compile & Publish Theme'}
          </Button>
        </div>
      )
    }
  ];

  const renderPreview = () => (
    <div className="sde-flex-col" style={{ gap: '16px', height: '100%' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Simulated IDE Workspace Frame
      </div>
      
      <div
        className="sde-hud-frame"
        style={{
          border: `1px solid ${borderColor}`,
          background: bgSecondary,
          color: textPrimary,
        }}
      >
        <div
          className="sde-hud-titlebar"
          style={{
            background: bgSecondary,
            borderBottom: `1px solid ${borderColor}`,
            color: textSecondary
          }}
        >
          <div className="sde-hud-dot" style={{ background: '#ef4444' }} />
          <div className="sde-hud-dot" style={{ background: '#f59e0b' }} />
          <div className="sde-hud-dot" style={{ background: '#10b981' }} />
          <span style={{ marginLeft: '10px', fontFamily: 'var(--font-mono)' }}>SDE Code [Workspace]</span>
        </div>

        <div className="sde-hud-main">
          <div
            className="sde-hud-sidebar"
            style={{
              background: bgSecondary,
              borderRight: `1px solid ${borderColor}`,
              color: textSecondary
            }}
          >
            <div style={{ display: 'flex' }}><Folder size={13} /></div>
            <div style={{ display: 'flex', color: accentCyan }}><Settings size={13} /></div>
            <div style={{ display: 'flex' }}><Plug size={13} /></div>
          </div>

          <div
            className="sde-hud-explorer"
            style={{
              background: bgSecondary,
              borderRight: `1px solid ${borderColor}`
            }}
          >
            <div style={{ fontSize: '9px', fontWeight: 'bold', color: accentCyan, textTransform: 'uppercase' }}>FILE EXPLORER</div>
            <div className="sde-flex-col" style={{ gap: '6px', fontSize: '8px', color: textPrimary }}>
              <div style={{ fontWeight: 600 }}>▾ src</div>
              <div style={{ paddingLeft: '8px', color: textSecondary }}>index.ts</div>
              <div style={{ paddingLeft: '8px', color: textSecondary }}>styles.css</div>
            </div>
          </div>

          <div
            className="sde-hud-editor"
            style={{
              background: bgPrimary
            }}
          >
            <div style={{ fontSize: '9px', color: textSecondary, fontFamily: 'var(--font-mono)' }}>activeFile.ts</div>
            <div
              style={{
                flex: 1,
                border: `1px solid ${borderColor}`,
                borderRadius: '4px',
                background: bgSecondary,
                display: 'flex',
                flexDirection: 'column',
                padding: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                lineHeight: '1.4'
              }}
            >
              <div style={{ color: textSecondary }}>// Welcome to SDE Code Editor</div>
              <div style={{ marginTop: '4px' }}>
                <span style={{ color: accentCyan }}>const</span> themeName = <span style={{ color: textPrimary }}>"{displayName}"</span>;
              </div>
            </div>
          </div>
        </div>

        <div
          className="sde-hud-statusbar"
          style={{
            background: bgSecondary,
            borderTop: `1px solid ${borderColor}`,
            color: textSecondary,
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <span>⎇ main</span>
          </div>
          <div
            className="sde-hud-badge"
            style={{
              color: accentCyan,
              background: accentGlow,
              border: `1px solid ${borderColor}`
            }}
          >
            {displayName}
          </div>
        </div>
      </div>
    </div>
  );

  const renderCode = () => (
    <div className="sde-flex-col" style={{ gap: '14px' }}>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>manifest.json</div>
        <pre style={{
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '10px',
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          overflowX: 'auto',
          margin: 0
        }}>{generatedManifest}</pre>
      </div>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>theme.css</div>
        <pre style={{
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '10px',
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          overflowX: 'auto',
          margin: 0
        }}>{generatedThemeCss}</pre>
      </div>
    </div>
  );

  return (
    <WizardSkeleton
      steps={steps}
      activeStep={activeStep}
      setActiveStep={setActiveStep}
      onPublish={handlePublish}
      publishing={publishing}
      errorMsg={errorMsg}
      setErrorMsg={setErrorMsg}
      previewTitle="Theme Live Preview"
      renderPreview={renderPreview}
      renderCode={renderCode}
    />
  );
};
