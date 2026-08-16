/** Pure read/write logic for .ipynb files (Jupyter's nbformat v4 JSON) — no IO, unit-testable
 * in both directions, same shape as workspaceFile.ts. We only round-trip what our kernel
 * protocol actually produces (stdout/stderr streams, a single error-with-traceback) — no rich
 * outputs (images/HTML/widgets), matching notebookKernelService.ts's documented scope decision.
 * A notebook written elsewhere with execute_result/display_data outputs is still readable: any
 * text/plain representation is shown as a plain stream output, everything else is dropped. */

export type NotebookCellType = 'code' | 'markdown';

export interface NotebookCellOutput {
  type: 'stream' | 'error';
  /** Only meaningful for type 'stream'. */
  name?: 'stdout' | 'stderr';
  /** Stream text, or the full traceback text for an error output. */
  text: string;
}

export interface NotebookCell {
  id: string;
  cellType: NotebookCellType;
  source: string;
  outputs: NotebookCellOutput[];
  executionCount: number | null;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  language: string;
}

export function generateCellId(): string {
  return `cell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** nbformat allows a cell's `source` as either one string or an array of lines (each usually
 * keeping its own trailing \n, per Jupyter convention) — accept both. */
function linesToSource(source: unknown): string {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) return source.filter((l): l is string => typeof l === 'string').join('');
  return '';
}

/** The inverse of linesToSource — splits into nbformat's per-line-with-trailing-\n array shape. */
function sourceToLines(source: string): string[] {
  if (source === '') return [];
  const parts = source.split('\n');
  return parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line));
}

function parseOutputs(raw: unknown): NotebookCellOutput[] {
  if (!Array.isArray(raw)) return [];
  const outputs: NotebookCellOutput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    if (o.output_type === 'stream') {
      const name = o.name === 'stderr' ? 'stderr' : 'stdout';
      outputs.push({ type: 'stream', name, text: linesToSource(o.text) });
    } else if (o.output_type === 'error') {
      const traceback = Array.isArray(o.traceback) ? o.traceback.filter((l): l is string => typeof l === 'string').join('\n') : '';
      outputs.push({ type: 'error', text: traceback });
    } else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
      const data = o.data as Record<string, unknown> | undefined;
      const plain = data?.['text/plain'];
      if (plain !== undefined) outputs.push({ type: 'stream', name: 'stdout', text: linesToSource(plain) });
    }
  }
  return outputs;
}

function serializeOutputs(outputs: NotebookCellOutput[]): unknown[] {
  return outputs.map((o) =>
    o.type === 'stream'
      ? { output_type: 'stream', name: o.name ?? 'stdout', text: sourceToLines(o.text) }
      : { output_type: 'error', ename: 'Error', evalue: '', traceback: o.text.split('\n') },
  );
}

/** Invalid/unparseable content yields an empty document rather than throwing — one corrupted
 * .ipynb shouldn't crash the caller; the store/UI layer decides how to present an empty notebook. */
export function parseNotebook(raw: string): NotebookDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { cells: [], language: 'python' };
  }
  if (!parsed || typeof parsed !== 'object') return { cells: [], language: 'python' };
  const doc = parsed as Record<string, unknown>;

  const metadata = (doc.metadata as Record<string, unknown> | undefined) ?? {};
  const kernelspec = metadata.kernelspec as Record<string, unknown> | undefined;
  const languageInfo = metadata.language_info as Record<string, unknown> | undefined;
  const language =
    (typeof kernelspec?.language === 'string' && kernelspec.language) ||
    (typeof languageInfo?.name === 'string' && languageInfo.name) ||
    'python';

  const rawCells = Array.isArray(doc.cells) ? doc.cells : [];
  const cells: NotebookCell[] = [];
  for (const entry of rawCells) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const cellType = c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'code' ? 'code' : null;
    if (!cellType) continue;
    cells.push({
      id: typeof c.id === 'string' && c.id ? c.id : generateCellId(),
      cellType,
      source: linesToSource(c.source),
      outputs: cellType === 'code' ? parseOutputs(c.outputs) : [],
      executionCount: cellType === 'code' && typeof c.execution_count === 'number' ? c.execution_count : null,
    });
  }

  return { cells, language };
}

export function serializeNotebook(doc: NotebookDocument): string {
  const nb = {
    cells: doc.cells.map((cell) =>
      cell.cellType === 'code'
        ? {
            cell_type: 'code',
            id: cell.id,
            metadata: {},
            execution_count: cell.executionCount,
            outputs: serializeOutputs(cell.outputs),
            source: sourceToLines(cell.source),
          }
        : {
            cell_type: 'markdown',
            id: cell.id,
            metadata: {},
            source: sourceToLines(cell.source),
          },
    ),
    metadata: {
      kernelspec: { display_name: doc.language, language: doc.language, name: doc.language },
      language_info: { name: doc.language },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(nb, null, 1);
}
