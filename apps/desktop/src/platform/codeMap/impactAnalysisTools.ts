import path from 'path';
import type { AITool } from '@sde-code/sdk';
import { resolveWorkspacePath, isWithinWorkspace } from '../ai/agentTools';
import type { IImpactAnalysisService } from './impactAnalysisService';

export interface ImpactAnalysisToolDeps {
  /** Every open workspace folder — same convention as agentTools.ts's own deps: a model-supplied relative path resolves against the first (primary) one. */
  workspaceFolders: string[];
  impactAnalysisService: IImpactAnalysisService;
}

/** Built query-time rather than merged through IExtensionToolProvider, since impact analysis needs the current workspaceFolders which listTools() has no way to receive — mirrors createRepoTools/createAgentTools. */
export function createImpactAnalysisTools(deps: ImpactAnalysisToolDeps): AITool[] {
  return [
    {
      name: 'analyze_code_impact',
      description:
        'Given a file path, reports which other files directly import it, which frontend/backend files are linked to it via a matching API route, and suggests test files that likely cover it. Use this before proposing a change to understand what else could be affected and what to test.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Workspace-relative (resolves against the primary open folder) or absolute path to the file to analyze.',
          },
        },
        required: ['filePath'],
      },
      execute: async (args) => {
        const filePath = typeof args.filePath === 'string' ? args.filePath : '';
        if (!filePath) return 'No filePath provided.';

        const resolved = resolveWorkspacePath(deps.workspaceFolders, filePath);
        if (!isWithinWorkspace(deps.workspaceFolders, resolved)) {
          return 'That path is outside every open workspace folder.';
        }

        const owningFolder =
          deps.workspaceFolders.find((folder) => {
            const normFolder = folder.replace(/\\/g, '/').replace(/\/$/, '');
            return resolved === normFolder || resolved.startsWith(`${normFolder}/`);
          }) ?? deps.workspaceFolders[0];
        const normFolder = owningFolder.replace(/\\/g, '/').replace(/\/$/, '');
        const relativePath = resolved.slice(normFolder.length).replace(/^\//, '');
        const projectId = path.basename(owningFolder) || 'default_proj';

        const report = deps.impactAnalysisService.getImpact(projectId, owningFolder, relativePath);

        if (report.directlyImports.length === 0 && report.matchesRoute.length === 0 && report.suggestedTests.length === 0) {
          return `No indexed dependents, route matches, or suggested tests found for ${filePath}. This reflects the current index (heuristic, not exhaustive) — it isn't a guarantee that nothing depends on this file.`;
        }

        const lines = [`Impact analysis for ${filePath}:`];
        if (report.directlyImports.length > 0) {
          lines.push(`Directly imported by: ${report.directlyImports.map((e) => e.filePath).join(', ')}`);
        }
        if (report.matchesRoute.length > 0) {
          lines.push(`Linked via a matching API route: ${report.matchesRoute.map((e) => e.filePath).join(', ')}`);
        }
        if (report.suggestedTests.length > 0) {
          lines.push(`Suggested tests: ${report.suggestedTests.join(', ')}`);
        }
        lines.push('(Route/URL matching and suggested tests are heuristic, not verified coverage — confirm before relying on them.)');
        return lines.join('\n');
      },
    },
  ];
}
