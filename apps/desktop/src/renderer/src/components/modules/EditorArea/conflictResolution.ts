export interface ConflictBlock {
  startLine: number;
  endLine: number;
  ours: string;
  theirs: string;
  base?: string;
}

/** Scans content for git conflict markers into resolvable blocks; handles both 2-way and diff3 3-way (`|||||||` base) styles. */
export function parseConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split(/\r\n|\r|\n/);
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      i++;
      continue;
    }
    const startIdx = i;
    let baseIdx = -1;
    let sepIdx = -1;
    let endIdx = -1;
    for (let j = startIdx + 1; j < lines.length; j++) {
      if (baseIdx === -1 && sepIdx === -1 && lines[j].startsWith('|||||||')) {
        baseIdx = j;
      } else if (sepIdx === -1 && lines[j].startsWith('=======')) {
        sepIdx = j;
      } else if (sepIdx !== -1 && lines[j].startsWith('>>>>>>>')) {
        endIdx = j;
        break;
      }
    }
    if (sepIdx === -1 || endIdx === -1) {
      break;
    }
    const oursEnd = baseIdx !== -1 ? baseIdx : sepIdx;
    blocks.push({
      startLine: startIdx + 1,
      endLine: endIdx + 1,
      ours: lines.slice(startIdx + 1, oursEnd).join('\n'),
      theirs: lines.slice(sepIdx + 1, endIdx).join('\n'),
      ...(baseIdx !== -1 ? { base: lines.slice(baseIdx + 1, sepIdx).join('\n') } : {}),
    });
    i = endIdx + 1;
  }
  return blocks;
}

/** Rebuilds content with each block replaced by one side; used by MergeEditorPanel's read-only reference panes, not the CodeLens path. */
export function substituteBlocks(content: string, blocks: ConflictBlock[], side: 'ours' | 'theirs'): string {
  const lines = content.split(/\r\n|\r|\n/);
  const result: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    result.push(...lines.slice(cursor, block.startLine - 1));
    const sideText = side === 'ours' ? block.ours : block.theirs;
    if (sideText.length > 0) result.push(...sideText.split('\n'));
    cursor = block.endLine;
  }
  result.push(...lines.slice(cursor));
  return result.join('\n');
}

// Registered once for the app's lifetime — Monaco stacks providers rather than replacing them on re-registration.
let registered = false;


export function registerConflictResolutionProvider(monaco: any): void {
  if (registered) return;
  registered = true;

  const applyResolution = (editor: any, block: ConflictBlock, choice: 'current' | 'incoming' | 'both') => {
    const model = editor.getModel();
    if (!model) return;
    const replacement =
      choice === 'current' ? block.ours : choice === 'incoming' ? block.theirs : [block.ours, block.theirs].filter((s) => s.length > 0).join('\n');
    const range = new monaco.Range(block.startLine, 1, block.endLine, model.getLineMaxColumn(block.endLine));
    editor.executeEdits('conflict-resolution', [{ range, text: replacement }]);
    editor.pushUndoStop();
  };

  monaco.editor.registerCommand(
    'sde.resolveConflict',
    (_accessor: any, model: any, block: ConflictBlock, choice: 'current' | 'incoming' | 'both') => {
      const editor = monaco.editor.getEditors().find((e: any) => e.getModel() === model);
      if (editor) applyResolution(editor, block, choice);
    },
  );

  // Same "enumerate real language ids, '*' isn't honored" workaround already
  // documented in registerSnippetCompletionProvider.ts.
  const languageIds = monaco.languages.getLanguages().map((l: { id: string }) => l.id);

  monaco.languages.registerCodeLensProvider(languageIds, {
    provideCodeLenses(model: any) {
      const blocks = parseConflictBlocks(model.getValue());
      const lenses = blocks.flatMap((block) => {
        const range = { startLineNumber: block.startLine, startColumn: 1, endLineNumber: block.startLine, endColumn: 1 };
        const make = (title: string, choice: 'current' | 'incoming' | 'both') => ({
          range,
          command: { id: 'sde.resolveConflict', title, arguments: [model, block, choice] },
        });
        return [make('Accept Current Change', 'current'), make('Accept Incoming Change', 'incoming'), make('Accept Both Changes', 'both')];
      });
      return { lenses, dispose: () => { } };
    },
  });
}
