/**
 * Runs inside the spawned Python process (via `python -u -c <this script>`) — turns a plain
 * interpreter into a minimal persistent "kernel": reads one cell's source at a time from
 * stdin, executes it in a namespace dict that survives across cells (the whole point of a
 * notebook — a variable from cell 1 is visible in cell 5), and reports results as one JSON
 * object per line on stdout so the main process never has to guess where one cell's output
 * ends and the next begins.
 *
 * Protocol (deliberately simple, not real Jupyter kernel messages — see
 * notebookKernelService.ts's doc comment for why):
 *   startup -> one {"type":"ready"} line, once the interpreter has finished booting
 *   stdin   -> zero or more source lines, then one line that's exactly CELL_END_MARKER
 *   stdout  -> zero or more {"type":"stream","name":"stdout"|"stderr","text":...} lines,
 *              emitted live as the cell's own print()/stderr writes happen, followed by
 *              exactly one {"type":"done","status":"ok"|"error","error":string|null} line.
 *
 * sys.stdout/sys.stderr are replaced with a tiny write()-only shim so a cell's own output
 * is captured and framed as it's produced, not buffered until the cell finishes — a cell
 * that runs for 10s and prints along the way should show output live, not all at once at
 * the end.
 */

export const CELL_END_MARKER = '\x00__SDE_CELL_END__\x00';

export const PYTHON_KERNEL_WRAPPER_SCRIPT = `
import sys, json, traceback

_globals = {'__name__': '__main__'}
_CELL_END = ${JSON.stringify(CELL_END_MARKER)}
_real_stdout = sys.stdout
_real_stdout.write(json.dumps({'type': 'ready'}) + '\\n')
_real_stdout.flush()

class _StreamWriter:
    def __init__(self, name):
        self.name = name
    def write(self, text):
        if text:
            _real_stdout.write(json.dumps({'type': 'stream', 'name': self.name, 'text': text}) + '\\n')
            _real_stdout.flush()
        return len(text)
    def flush(self):
        pass
    def isatty(self):
        return False

sys.stdout = _StreamWriter('stdout')
sys.stderr = _StreamWriter('stderr')

while True:
    lines = []
    while True:
        line = sys.stdin.readline()
        if line == '':
            sys.exit(0)
        if line.rstrip('\\n') == _CELL_END:
            break
        lines.append(line)
    code = ''.join(lines)

    status = 'ok'
    error_text = None
    try:
        exec(compile(code, '<cell>', 'exec'), _globals)
    except BaseException:
        status = 'error'
        error_text = traceback.format_exc()

    _real_stdout.write(json.dumps({'type': 'done', 'status': status, 'error': error_text}) + '\\n')
    _real_stdout.flush()
`;
