import { describe, expect, it } from 'vitest';
import { parseNotebook, serializeNotebook, type NotebookDocument } from './notebookFormat';

describe('parseNotebook', () => {
  it('parses code and markdown cells, source given as an array of lines', () => {
    const raw = JSON.stringify({
      cells: [
        { cell_type: 'code', id: 'c1', execution_count: 3, outputs: [], source: ['x = 1\n', 'x + 1'] },
        { cell_type: 'markdown', id: 'm1', source: ['# Title'] },
      ],
      metadata: { kernelspec: { language: 'python' } },
      nbformat: 4,
      nbformat_minor: 5,
    });

    const doc = parseNotebook(raw);
    expect(doc.language).toBe('python');
    expect(doc.cells).toEqual([
      { id: 'c1', cellType: 'code', source: 'x = 1\nx + 1', outputs: [], executionCount: 3 },
      { id: 'm1', cellType: 'markdown', source: '# Title', outputs: [], executionCount: null },
    ]);
  });

  it('accepts source given as a single string too', () => {
    const raw = JSON.stringify({
      cells: [{ cell_type: 'code', id: 'c1', source: 'print(1)', outputs: [] }],
      metadata: {},
    });
    expect(parseNotebook(raw).cells[0].source).toBe('print(1)');
  });

  it('parses stream and error outputs', () => {
    const raw = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          id: 'c1',
          source: '',
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['hello\n', 'world\n'] },
            { output_type: 'error', ename: 'ValueError', evalue: 'boom', traceback: ['Traceback...', 'ValueError: boom'] },
          ],
        },
      ],
      metadata: {},
    });

    expect(parseNotebook(raw).cells[0].outputs).toEqual([
      { type: 'stream', name: 'stdout', text: 'hello\nworld\n' },
      { type: 'error', text: 'Traceback...\nValueError: boom' },
    ]);
  });

  it('falls back a text/plain execute_result to a plain stdout stream output', () => {
    const raw = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          id: 'c1',
          source: '',
          outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['42'] } }],
        },
      ],
      metadata: {},
    });
    expect(parseNotebook(raw).cells[0].outputs).toEqual([{ type: 'stream', name: 'stdout', text: '42' }]);
  });

  it('drops a rich display_data output with no text/plain representation', () => {
    const raw = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          id: 'c1',
          source: '',
          outputs: [{ output_type: 'display_data', data: { 'image/png': 'base64...' } }],
        },
      ],
      metadata: {},
    });
    expect(parseNotebook(raw).cells[0].outputs).toEqual([]);
  });

  it('defaults language to python when metadata is missing', () => {
    expect(parseNotebook(JSON.stringify({ cells: [] })).language).toBe('python');
  });

  it('reads language from language_info when kernelspec.language is absent', () => {
    const raw = JSON.stringify({ cells: [], metadata: { language_info: { name: 'javascript' } } });
    expect(parseNotebook(raw).language).toBe('javascript');
  });

  it('generates an id for a cell missing one', () => {
    const raw = JSON.stringify({ cells: [{ cell_type: 'code', source: '', outputs: [] }], metadata: {} });
    expect(parseNotebook(raw).cells[0].id).toEqual(expect.any(String));
    expect(parseNotebook(raw).cells[0].id.length).toBeGreaterThan(0);
  });

  it('drops a cell with an unrecognized cell_type rather than throwing', () => {
    const raw = JSON.stringify({ cells: [{ cell_type: 'raw', source: 'ignored' }], metadata: {} });
    expect(parseNotebook(raw).cells).toEqual([]);
  });

  it('returns an empty document (not a throw) for invalid JSON', () => {
    expect(parseNotebook('{ not valid json')).toEqual({ cells: [], language: 'python' });
  });

  it('returns an empty document when cells is missing or not an array', () => {
    expect(parseNotebook(JSON.stringify({}))).toEqual({ cells: [], language: 'python' });
    expect(parseNotebook(JSON.stringify({ cells: 'nope' }))).toEqual({ cells: [], language: 'python' });
  });
});

describe('serializeNotebook', () => {
  it('round-trips a full document through parseNotebook', () => {
    const doc: NotebookDocument = {
      language: 'python',
      cells: [
        {
          id: 'c1',
          cellType: 'code',
          source: 'x = 1\nprint(x)',
          outputs: [{ type: 'stream', name: 'stdout', text: '1\n' }],
          executionCount: 2,
        },
        { id: 'm1', cellType: 'markdown', source: '# Notes\nsome text', outputs: [], executionCount: null },
      ],
    };
    expect(parseNotebook(serializeNotebook(doc))).toEqual(doc);
  });

  it('round-trips an error output', () => {
    const doc: NotebookDocument = {
      language: 'python',
      cells: [{ id: 'c1', cellType: 'code', source: 'raise ValueError()', outputs: [{ type: 'error', text: 'Traceback...\nValueError' }], executionCount: 1 }],
    };
    expect(parseNotebook(serializeNotebook(doc))).toEqual(doc);
  });

  it('round-trips an empty notebook', () => {
    const doc: NotebookDocument = { language: 'python', cells: [] };
    expect(parseNotebook(serializeNotebook(doc))).toEqual(doc);
  });

  it('writes valid nbformat 4.5 envelope fields', () => {
    const written = JSON.parse(serializeNotebook({ language: 'python', cells: [] }));
    expect(written.nbformat).toBe(4);
    expect(written.nbformat_minor).toBe(5);
    expect(written.metadata.kernelspec.language).toBe('python');
    expect(written.metadata.language_info.name).toBe('python');
  });

  it('round-trips a cell whose source is empty', () => {
    const doc: NotebookDocument = { language: 'python', cells: [{ id: 'c1', cellType: 'code', source: '', outputs: [], executionCount: null }] };
    expect(parseNotebook(serializeNotebook(doc))).toEqual(doc);
  });
});
