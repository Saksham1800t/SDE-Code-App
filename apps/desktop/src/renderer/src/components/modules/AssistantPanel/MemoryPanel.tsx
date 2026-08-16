import React, { useState, useEffect, useCallback } from 'react';
import './AssistantPanel.css';
import { useWorkspaceStore } from '../../../store/workspace';
import { Button } from '../../common/Button';
import { Switch } from '../../common/Switch';
import { Brain, X } from 'lucide-react';

interface ProjectRule {
  id: string;
  project_id: string;
  rule_text: string;
  is_active: number;
}

interface ProjectMemory {
  id: string;
  project_id: string;
  memory_key: string;
  memory_val: string;
  created_at: number;
}

export const MemoryPanel: React.FC = () => {
  const { workspaceName } = useWorkspaceStore();

  const [rules, setRules] = useState<ProjectRule[]>([]);
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [newMemoryKey, setNewMemoryKey] = useState('');
  const [newMemoryVal, setNewMemoryVal] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleText, setEditingRuleText] = useState('');

  const loadAll = useCallback(async () => {
    const api = window.api;
    if (!api || !workspaceName) {
      setRules([]);
      setMemories([]);
      return;
    }
    try {
      const [loadedRules, loadedMemories] = await Promise.all([
        api.getProjectRules(workspaceName),
        api.getProjectMemories(workspaceName),
      ]);
      setRules(loadedRules || []);
      setMemories(loadedMemories || []);
    } catch (err) {
      console.error('Failed to load project rules/memories:', err);
    }
  }, [workspaceName]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleAddRule = async () => {
    const text = newRuleText.trim();
    const api = window.api;
    if (!text || !api || !workspaceName) return;
    await api.saveProjectRule(crypto.randomUUID(), workspaceName, text);
    setNewRuleText('');
    loadAll();
  };

  const handleToggleRule = async (rule: ProjectRule) => {
    const api = window.api;
    if (!api) return;
    await api.setProjectRuleActive(rule.id, rule.is_active !== 1);
    loadAll();
  };

  const handleDeleteRule = async (id: string) => {
    const api = window.api;
    if (!api) return;
    await api.deleteProjectRule(id);
    loadAll();
  };

  const startEditingRule = (rule: ProjectRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleText(rule.rule_text);
  };

  const commitRuleEdit = async () => {
    const api = window.api;
    const text = editingRuleText.trim();
    if (api && workspaceName && editingRuleId && text) {
      await api.saveProjectRule(editingRuleId, workspaceName, text);
    }
    setEditingRuleId(null);
    setEditingRuleText('');
    loadAll();
  };

  const handleAddMemory = async () => {
    const key = newMemoryKey.trim();
    const val = newMemoryVal.trim();
    const api = window.api;
    if (!key || !val || !api || !workspaceName) return;
    await api.saveProjectMemory(crypto.randomUUID(), workspaceName, key, val);
    setNewMemoryKey('');
    setNewMemoryVal('');
    loadAll();
  };

  const handleDeleteMemory = async (id: string) => {
    const api = window.api;
    if (!api) return;
    await api.deleteProjectMemory(id);
    loadAll();
  };

  if (!workspaceName) {
    return (
      <div className="sde-assistant-messages">
        <div className="sde-assistant-empty">
          <div className="sde-assistant-empty-icon"><Brain size={28} /></div>
          <h4>No project open</h4>
          <p>Open a folder to define the rules and memory the AI uses for that project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sde-memory-panel">
      {/* ── Rules ─────────────────────────────────────────────── */}
      <div className="sde-memory-section">
        <h4 className="sde-memory-section-title">Rules</h4>
        <p className="sde-memory-section-desc">
          Instructions the AI follows in every chat for <strong>{workspaceName}</strong>. Toggle a rule off to keep it without applying it.
        </p>

        {rules.length === 0 && <div className="sde-memory-empty-hint">No rules yet.</div>}

        {rules.map((rule) => (
          <div key={rule.id} className={`sde-memory-row${rule.is_active === 1 ? '' : ' inactive'}`}>
            <Switch checked={rule.is_active === 1} onChange={() => handleToggleRule(rule)} />
            {editingRuleId === rule.id ? (
              <textarea
                className="sde-memory-edit-input"
                value={editingRuleText}
                onChange={(e) => setEditingRuleText(e.target.value)}
                onBlur={commitRuleEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitRuleEdit();
                  }
                  if (e.key === 'Escape') {
                    setEditingRuleId(null);
                    setEditingRuleText('');
                  }
                }}
                autoFocus
                rows={2}
              />
            ) : (
              <span className="sde-memory-row-text" title="Click to edit" onClick={() => startEditingRule(rule)}>
                {rule.rule_text}
              </span>
            )}
            <button className="sde-memory-delete-btn" aria-label="Delete rule" onClick={() => handleDeleteRule(rule.id)}>
              <X size={12} />
            </button>
          </div>
        ))}

        <div className="sde-memory-add-row">
          <textarea
            className="sde-memory-add-input"
            placeholder="e.g. Always use TypeScript strict mode"
            value={newRuleText}
            onChange={(e) => setNewRuleText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddRule();
              }
            }}
            rows={2}
          />
          <Button size="sm" onClick={handleAddRule} disabled={!newRuleText.trim()}>
            Add Rule
          </Button>
        </div>
      </div>

      {/* ── Memory ────────────────────────────────────────────── */}
      <div className="sde-memory-section">
        <h4 className="sde-memory-section-title">Memory</h4>
        <p className="sde-memory-section-desc">
          Facts the AI remembers about this project (framework, conventions, context).
        </p>

        {memories.length === 0 && <div className="sde-memory-empty-hint">Nothing remembered yet.</div>}

        {memories.map((memory) => (
          <div key={memory.id} className="sde-memory-row">
            <span className="sde-memory-row-text">
              <strong className="sde-memory-key">{memory.memory_key}</strong>
              <span className="sde-memory-val">{memory.memory_val}</span>
            </span>
            <button
              className="sde-memory-delete-btn"
              aria-label="Delete memory"
              onClick={() => handleDeleteMemory(memory.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <div className="sde-memory-add-row sde-memory-add-row--kv">
          <input
            className="sde-memory-add-input"
            placeholder="Key (e.g. framework)"
            value={newMemoryKey}
            onChange={(e) => setNewMemoryKey(e.target.value)}
          />
          <input
            className="sde-memory-add-input"
            placeholder="Value (e.g. React 18 + Zustand)"
            value={newMemoryVal}
            onChange={(e) => setNewMemoryVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddMemory();
            }}
          />
          <Button size="sm" onClick={handleAddMemory} disabled={!newMemoryKey.trim() || !newMemoryVal.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
};
