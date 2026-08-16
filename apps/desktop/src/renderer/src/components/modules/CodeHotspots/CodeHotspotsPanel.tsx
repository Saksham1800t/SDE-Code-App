import React, { useEffect, useState } from 'react';
import './CodeHotspots.css';
import { useGitStore } from '../../../store/git';
import { useWorkspaceStore } from '../../../store/workspace';
import { useAgentStore } from '../../../store/agent';
import { intensityColor } from '../../../utils/heatmapColors';
import { oneShotAIQuery } from '../../../utils/oneShotAIQuery';
import { Button } from '../../common/Button';
import { notify } from '../../../store/notifications';
import { Sparkles } from 'lucide-react';

export const CodeHotspotsPanel: React.FC = () => {
  const { fileHotspots, gitLoadFileHotspots } = useGitStore();
  const openFile = useWorkspaceStore((s) => s.openFile);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const { activeAIProvider, activeAIModel } = useAgentStore();
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    gitLoadFileHotspots();
  }, []);

  const maxCount = fileHotspots?.[0]?.changeCount ?? 0;

  const handleAnalyze = async () => {
    if (!fileHotspots || fileHotspots.length === 0) return;
    setAnalyzing(true);
    try {
      const list = fileHotspots.slice(0, 20).map((h) => `${h.path}: ${h.changeCount} changes`).join('\n');
      const prompt = `Here are the most frequently-changed files in a git repository, ranked by change count:\n\n${list}\n\nIdentify likely risk areas, refactoring candidates, or notable patterns in this churn data. Keep it to 3-5 sentences.`;
      const insight = await oneShotAIQuery(activeAIProvider, activeAIModel, prompt);
      setAiInsight(insight);
    } catch (err: any) {
      notify.error(err.message || 'Failed to generate insight.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="sde-code-hotspots-panel">
      <div className="sde-code-hotspots-container">
        <div className="sde-code-hotspots-title">Code Hotspots</div>

        <div className="sde-code-hotspots-caption">
          Files ranked by how often they change. Renamed files may appear as two separate entries — old and new paths are counted independently.
        </div>

        {fileHotspots && fileHotspots.length > 0 && (
          <div className="sde-code-hotspots-ai-trigger">
            {aiInsight ? (
              <div className="sde-code-hotspots-ai-insight">{aiInsight}</div>
            ) : (
              <Button onClick={handleAnalyze} disabled={analyzing} size="sm">
                {analyzing ? 'Analyzing…' : <><Sparkles size={13} /> Analyze with AI</>}
              </Button>
            )}
          </div>
        )}

        {fileHotspots === null ? (
          <div className="sde-code-hotspots-loading">Loading file hotspots...</div>
        ) : fileHotspots.length === 0 ? (
          <div className="sde-code-hotspots-empty">No file history yet.</div>
        ) : (
          <div className="sde-code-hotspots-list">
            {fileHotspots.map((hotspot) => {
              const fileName = hotspot.path.split('/').pop() || hotspot.path;
              return (
                <div
                  key={hotspot.path}
                  className="sde-code-hotspots-row"
                  onClick={() => openFile(`${workspacePath}/${hotspot.path}`, fileName)}
                >
                  <div
                    className="sde-code-hotspots-bar"
                    style={{ background: intensityColor(hotspot.changeCount, maxCount) }}
                  />
                  <div className="sde-code-hotspots-info">
                    <span className="sde-code-hotspots-name">{fileName}</span>
                    <span className="sde-code-hotspots-path">{hotspot.path}</span>
                  </div>
                  <span className="sde-code-hotspots-count">{hotspot.changeCount}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
