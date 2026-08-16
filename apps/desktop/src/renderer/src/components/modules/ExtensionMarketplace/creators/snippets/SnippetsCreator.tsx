import React, { useState, useEffect, useMemo } from 'react';
import { parse as parseJsonc, ParseError } from 'jsonc-parser';
import '../../ExtensionMarketplace.css';
import { WizardSkeleton } from '../WizardSkeleton';
import { Input, TextArea } from '../../../../common/Input';
import { Select } from '../../../../common/Select';
import { Switch } from '../../../../common/Switch';
import { Button } from '../../../../common/Button';
import { EXTENSION_CATEGORIES, ExtensionCategory } from '../../extensionCategories';
import { useExtensionIdAvailability } from '../useExtensionIdAvailability';
import { notify } from '../../../../../store/notifications';
import { Check, X, AlertTriangle } from 'lucide-react';
import { getPlaceholderIcon } from '../../../../../utils/extensionIcon';

interface SnippetsCreatorProps {
  token: string | null;
  user: any;
  onSuccess: (message: string) => void;
  languageId: string;
}

interface SnippetEntry {
  id: string;
  name: string;
  prefix: string;
  body: string;
  description: string;
}

const genId = () => Math.random().toString(36).substring(2, 11);

export const SnippetsCreator: React.FC<SnippetsCreatorProps> = ({ token, user, onSuccess, languageId }) => {
  const [activeStep, setActiveStep] = useState<number>(1);

  // Source snippet loading — one-way copy, this never writes back to the
  // original personal snippet file.
  const [loadingSource, setLoadingSource] = useState(true);
  const [snippets, setSnippets] = useState<SnippetEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewEntryId, setPreviewEntryId] = useState<string | null>(null);

  // Metadata
  const capitalizedLang = languageId ? languageId[0].toUpperCase() + languageId.slice(1) : languageId;
  const [extensionId, setExtensionId] = useState(`snippets.${languageId}.${(user?.username || 'self').toLowerCase()}`);
  const [displayName, setDisplayName] = useState(`${capitalizedLang} Snippets`);
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState(`Personal ${languageId} snippets, shared as an extension.`);
  const [publisher, setPublisher] = useState(user?.username || 'Self');

  // Visibility & discovery
  const [isPublic, setIsPublic] = useState(true);
  const [category, setCategory] = useState<ExtensionCategory>('Snippets');
  const [tagsInput, setTagsInput] = useState('');

  const [publishing, setPublishing] = useState(false);

  const { taken: idTaken } = useExtensionIdAvailability(extensionId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSource(true);
      try {
        const api = window.api;
        const raw = await api.getUserSnippetFileContent(languageId);
        const errors: ParseError[] = [];
        const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
        if (cancelled) return;
        if (errors.length > 0) {
          notify.warning(`Your personal ${languageId} snippet file has ${errors.length} syntax issue(s); loaded as much as possible.`);
        }
        const entries: SnippetEntry[] = Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).map(([name, def]: [string, any]) => ({
          id: genId(),
          name,
          prefix: Array.isArray(def?.prefix) ? def.prefix.join(', ') : (def?.prefix ?? ''),
          body: Array.isArray(def?.body) ? def.body.join('\n') : (def?.body ?? ''),
          description: def?.description ?? '',
        }));
        setSnippets(entries);
        setPreviewEntryId(entries[0]?.id ?? null);
      } catch (err: any) {
        if (!cancelled) notify.error(`Could not load your personal ${languageId} snippets: ${err.message || err}`);
      } finally {
        if (!cancelled) setLoadingSource(false);
      }
    })();
    return () => { cancelled = true; };
  }, [languageId]);

  const addEntry = () => {
    const entry: SnippetEntry = { id: genId(), name: 'New Snippet', prefix: '', body: '', description: '' };
    setSnippets((s) => [...s, entry]);
    setEditingId(entry.id);
  };

  const updateEntry = (id: string, patch: Partial<SnippetEntry>) => {
    setSnippets((s) => s.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEntry = (id: string) => {
    setSnippets((s) => s.filter((e) => e.id !== id));
    if (editingId === id) setEditingId(null);
    if (previewEntryId === id) setPreviewEntryId(null);
  };

  const snippetsBody = useMemo(() => {
    const obj: Record<string, any> = {};
    for (const e of snippets) {
      if (!e.name.trim()) continue;
      const prefixArr = e.prefix.split(',').map((p) => p.trim()).filter(Boolean);
      const bodyArr = e.body.split('\n');
      while (bodyArr.length > 1 && bodyArr[bodyArr.length - 1].trim() === '') bodyArr.pop();
      obj[e.name] = {
        prefix: prefixArr.length <= 1 ? (prefixArr[0] ?? '') : prefixArr,
        body: bodyArr.length <= 1 ? (bodyArr[0] ?? '') : bodyArr,
        ...(e.description.trim() ? { description: e.description.trim() } : {}),
      };
    }
    return obj;
  }, [snippets]);

  const manifestPreview = useMemo(() => JSON.stringify({
    id: extensionId,
    name: displayName,
    version,
    description,
    publisher,
    provides: ['snippets'],
    dependsOn: [],
    contributes: { snippets: [{ language: languageId, path: `snippets/${languageId}.json` }] },
  }, null, 2), [extensionId, displayName, version, description, publisher, languageId]);

  const snippetsBodyPreview = useMemo(() => JSON.stringify(snippetsBody, null, 2), [snippetsBody]);

  const canPublish = snippets.length > 0 && snippets.every((e) => e.name.trim() && e.prefix.trim());

  const handlePublish = async () => {
    if (!canPublish) {
      notify.error('Add at least one snippet, and make sure every snippet has a name and a prefix.');
      return;
    }
    setPublishing(true);
    const api = window.api;
    if (!api || !api.scaffoldAndPublishExtension) {
      notify.error('Extension developer SDK IPC bridge is missing.');
      setPublishing(false);
      return;
    }
    if (!token) {
      notify.error('You must be logged in to publish an extension.');
      setPublishing(false);
      return;
    }

    try {
      await api.scaffoldAndPublishExtension({
        id: extensionId,
        name: displayName,
        version,
        description,
        publisher,
        provides: ['snippets'],
        dependsOn: [],
        templateConfig: {
          templateType: 'snippets',
          languageId,
          snippetsBody,
        },
        categories: [category],
        tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        isPublic,
        token,
      });

      onSuccess(`Snippets extension "${displayName}" generated and published successfully!`);
    } catch (err: any) {
      notify.error(err.message || 'Compiler packaging failed.');
    } finally {
      setPublishing(false);
    }
  };

  const previewEntry = snippets.find((e) => e.id === previewEntryId) ?? snippets[0];
  const icon = getPlaceholderIcon(extensionId);

  const steps = [
    {
      title: 'Review Your Snippets',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '12px' }}>
          {loadingSource ? (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading your personal {languageId} snippets…</p>
          ) : snippets.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No snippets yet — add one below to get started.</p>
          ) : (
            <div className="sde-flex-col" style={{ gap: '8px' }}>
              {snippets.map((entry) => (
                <div key={entry.id} className="sde-snippet-entry-row">
                  {editingId === entry.id ? (
                    <div className="sde-flex-col" style={{ gap: '8px', width: '100%' }}>
                      <Input label="Name" value={entry.name} onChange={(e) => updateEntry(entry.id, { name: e.target.value })} />
                      <Input label="Prefix(es), comma-separated" value={entry.prefix} onChange={(e) => updateEntry(entry.id, { prefix: e.target.value })} />
                      <TextArea label="Body (one line per row)" value={entry.body} onChange={(e) => updateEntry(entry.id, { body: e.target.value })} rows={4} />
                      <Input label="Description" value={entry.description} onChange={(e) => updateEntry(entry.id, { description: e.target.value })} />
                      <Button onClick={() => setEditingId(null)} variant="primary" size="sm">Done</Button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="sde-snippet-entry-name">{entry.name || '(unnamed)'}</div>
                        <div className="sde-snippet-entry-prefix">{entry.prefix || '(no prefix)'}</div>
                      </div>
                      <div className="sde-snippet-entry-actions">
                        <button className="sde-wizard-entry-action-btn" title="Edit" onClick={() => setEditingId(entry.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button className="sde-wizard-entry-action-btn sde-wizard-entry-action-btn--danger" title="Remove" onClick={() => removeEntry(entry.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button onClick={addEntry} variant="secondary" size="sm">+ Add Snippet</Button>
        </div>
      ),
    },
    {
      title: 'Extension Metadata',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '12px' }}>
          <div className="sde-theme-creator-grid">
            <div>
              <Input label="Extension ID" value={extensionId} onChange={(e) => setExtensionId(e.target.value.replace(/\s+/g, '-').toLowerCase())} />
              {idTaken && (
                <p className="sde-wizard-id-warning">
                  <AlertTriangle size={12} /> This ID is already taken in the marketplace — pick a different one.
                </p>
              )}
            </div>
            <Input label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="sde-theme-creator-grid">
            <Input label="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input label="Publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </div>
          <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
      ),
    },
    {
      title: 'Visibility & Discovery',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '16px' }}>
          <div className="sde-wizard-toggle-row">
            <div className="sde-wizard-toggle-info">
              <div className="sde-wizard-toggle-name">Public</div>
              <div className="sde-wizard-toggle-desc">Public extensions are discoverable by anyone in the Marketplace. Private ones are only visible to you.</div>
            </div>
            <Switch checked={isPublic} onChange={setIsPublic} />
          </div>
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as ExtensionCategory)}>
            {EXTENSION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Tags, comma-separated" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder={`${languageId}, snippets, productivity`} />
        </div>
      ),
    },
    {
      title: 'Validate & Publish',
      renderForm: () => (
        <div className="sde-flex-col" style={{ gap: '16px' }}>
          <div className="sde-theme-publish-grid">
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Extension ID</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{extensionId}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Capability</div>
              <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '2px', fontWeight: 600 }}>contributes.snippets: [{languageId}]</div>
            </div>
          </div>

          <div className="sde-flex-col" style={{ gap: '10px' }}>
            <h4 style={{ fontSize: '12px', color: 'var(--text-primary)', margin: 0, fontWeight: 650 }}>PRE-PUBLISH CHECKLIST</h4>
            <div className="sde-flex-col" style={{ gap: '6px' }}>
              <div className={`sde-theme-checklist-row${snippets.length > 0 ? '' : ' sde-theme-checklist-row--pending'}`}>
                {snippets.length > 0 ? <Check size={12} /> : <X size={12} />} At least one snippet defined
              </div>
              <div className={`sde-theme-checklist-row${canPublish ? '' : ' sde-theme-checklist-row--pending'}`}>
                {canPublish ? <Check size={12} /> : <X size={12} />} Every snippet has a name and a prefix
              </div>
              <div className="sde-theme-checklist-row">
                <Check size={12} /> Your original personal snippet file will not be modified
              </div>
              <div className={`sde-theme-checklist-row${idTaken ? ' sde-theme-checklist-row--warning' : ''}`}>
                {idTaken ? <AlertTriangle size={12} /> : <Check size={12} />} Extension ID is unique
              </div>
            </div>
          </div>

          <Button onClick={handlePublish} disabled={publishing || !canPublish || idTaken} variant="primary" fullWidth style={{ height: '36px' }}>
            {publishing ? 'Generating & Publishing Extension...' : 'Compile & Publish Extension'}
          </Button>
        </div>
      ),
    },
  ];

  const renderPreview = () => (
    <div className="sde-flex-col" style={{ gap: '16px', height: '100%' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Simulated Snippet Expansion
      </div>

      {snippets.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {snippets.map((e) => (
            <button
              key={e.id}
              onClick={() => setPreviewEntryId(e.id)}
              className={`sde-wizard-pill${previewEntry?.id === e.id ? ' sde-wizard-pill--active' : ''}`}
            >
              {e.name}
            </button>
          ))}
        </div>
      )}

      <div className="sde-hud-frame" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
        <div className="sde-hud-titlebar" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
          <div className="sde-hud-dot" style={{ background: 'var(--color-danger)' }} />
          <div className="sde-hud-dot" style={{ background: 'var(--color-warning)' }} />
          <div className="sde-hud-dot" style={{ background: 'var(--color-success)' }} />
          <span style={{ marginLeft: '10px', fontFamily: 'var(--font-mono)' }}>SDE Code [{languageId}]</span>
        </div>

        <div className="sde-hud-editor" style={{ background: 'var(--bg-primary)', padding: '10px' }}>
          {previewEntry ? (
            <SnippetTypingSimulator entry={previewEntry} />
          ) : (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Add a snippet to see a live preview.</div>
          )}
        </div>

        <div className="sde-hud-statusbar" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{
              width: 14, height: 14, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', background: `${icon.color}26`, color: icon.color,
            }}>
              {icon.letter}
            </div>
            <span>{displayName}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCode = () => (
    <div className="sde-flex-col" style={{ gap: '14px' }}>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>manifest.json</div>
        <pre className="sde-wizard-code-block">{manifestPreview}</pre>
      </div>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>snippets/{languageId}.json</div>
        <pre className="sde-wizard-code-block">{snippetsBodyPreview}</pre>
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
      previewTitle="Snippet Live Preview"
      renderPreview={renderPreview}
      renderCode={renderCode}
    />
  );
};

const SnippetTypingSimulator: React.FC<{ entry: SnippetEntry }> = ({ entry }) => {
  const [typed, setTyped] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const prefix = entry.prefix.split(',')[0]?.trim() ?? '';
    setTyped('');
    setExpanded(false);
    let i = 0;
    const typeTimer = setInterval(() => {
      i++;
      setTyped(prefix.slice(0, i));
      if (i >= prefix.length) {
        clearInterval(typeTimer);
        setTimeout(() => setExpanded(true), 500);
      }
    }, 90);
    return () => clearInterval(typeTimer);
  }, [entry.id, entry.prefix]);

  const bodyLines = entry.body.split('\n');

  return (
    <div style={{
      border: '1px solid var(--border-color)', borderRadius: 4, background: 'var(--bg-secondary)',
      padding: 10, fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.5, minHeight: 90,
    }}>
      <div style={{ color: 'var(--text-secondary)' }}>// Type "<span style={{ color: 'var(--accent-cyan)' }}>{typed}</span>" and hit Tab</div>
      {expanded ? (
        <div style={{ marginTop: 6 }}>
          {bodyLines.map((line, i) => (
            <div key={i} style={{ color: 'var(--text-primary)' }}>{line || ' '}</div>
          ))}
          <span className="sde-wizard-tab-badge">Tab ⇥</span>
        </div>
      ) : (
        <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>…</div>
      )}
    </div>
  );
};
