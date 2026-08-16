import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { databaseService } from '../../host/services';

interface SymbolInfo {
  name: string;
  kind: 'class' | 'function' | 'component' | 'service';
  line: number;
  column: number;
}

interface ImportInfo {
  moduleName: string;
  symbols: string[];
}

interface RouteInfo {
  pattern: string;
  method: string;
  handler: string;
  line: number;
}

interface CallSiteInfo {
  method: string;
  urlPattern: string;
  line: number;
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'build', 'out', 'bin', 'obj', '.svelte-kit', '.next']);
const PARSABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.cs']);
// Matches searchService.ts's own 5000-file cap — a safety valve against any large/pathological directory the exclude list doesn't anticipate.
const MAX_INDEXABLE_FILES = 5000;

// Parses and persists everything derived from one file, returning the symbol count. Deliberately doesn't open its own transaction, so callers (indexWorkspace/reindexFile) control batching without risking a nested BEGIN TRANSACTION.
function parseAndPersistFile(projectId: string, file: string, relPath: string, content: string): number {
  let symbolCount = 0;
  const hash = crypto.createHash('md5').update(content).digest('hex');

  const symbols = parseSymbols(content, file);
  const imports = parseImports(content);
  const routes = parseRoutes(content);
  const callSites = parseCallSites(content);

  // 1. Insert Symbols
  symbols.forEach((sym) => {
    const symId = `sym_${Math.random().toString(36).substring(2, 11)}`;
    databaseService.run(
      'INSERT INTO symbols (id, project_id, file_path, name, kind, line_number, column_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [symId, projectId, relPath, sym.name, sym.kind, sym.line, sym.column]
    );
    symbolCount++;

    // Categorize Components & Services
    if (sym.kind === 'component') {
      const compId = `comp_${Math.random().toString(36).substring(2, 11)}`;
      databaseService.run(
        'INSERT INTO components (id, project_id, name, file_path) VALUES (?, ?, ?, ?)',
        [compId, projectId, sym.name, relPath]
      );
    } else if (sym.kind === 'service') {
      const servId = `serv_${Math.random().toString(36).substring(2, 11)}`;
      databaseService.run(
        'INSERT INTO services (id, project_id, name, file_path) VALUES (?, ?, ?, ?)',
        [servId, projectId, sym.name, relPath]
      );
    }
  });

  // 2. Insert Imports
  imports.forEach((imp) => {
    const impId = `imp_${Math.random().toString(36).substring(2, 11)}`;
    databaseService.run(
      'INSERT INTO imports (id, project_id, file_path, module_name, imported_symbols) VALUES (?, ?, ?, ?, ?)',
      [impId, projectId, relPath, imp.moduleName, JSON.stringify(imp.symbols)]
    );
  });

  // 3. Insert Routes
  routes.forEach((route) => {
    const routeId = `route_${Math.random().toString(36).substring(2, 11)}`;
    databaseService.run(
      'INSERT INTO routes (id, project_id, path_pattern, handler, file_path) VALUES (?, ?, ?, ?, ?)',
      [routeId, projectId, `${route.method.toUpperCase()} ${route.pattern}`, route.handler, relPath]
    );
  });

  // 4. Insert Frontend Call Sites — caller is the closest preceding symbol already parsed above for this file, no separate parsing pass.
  callSites.forEach((callSite) => {
    const callerSymbol = symbols.filter((sym) => sym.line <= callSite.line).pop()?.name ?? null;
    const callSiteId = `callsite_${Math.random().toString(36).substring(2, 11)}`;
    databaseService.run(
      'INSERT INTO frontend_call_sites (id, project_id, file_path, method, url_pattern, caller_symbol, line_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [callSiteId, projectId, relPath, callSite.method, callSite.urlPattern, callerSymbol, callSite.line]
    );
  });

  // 5. Record References
  symbols.forEach((sym) => {
    // Find symbol references across files by checking if it occurs in file contents
    // Note: In a fully scaled system we would use AST resolving, here we check text occurrences
    if (content.includes(sym.name)) {
      const refId = `ref_${Math.random().toString(36).substring(2, 11)}`;
      databaseService.run(
        'INSERT INTO [references] (id, project_id, symbol_name, file_path, line_number) VALUES (?, ?, ?, ?, ?)',
        [refId, projectId, sym.name, relPath, sym.line]
      );
    }
  });

  // 6. Save in project_index
  const indexId = `idx_${Math.random().toString(36).substring(2, 11)}`;
  databaseService.run(
    'INSERT INTO project_index (id, project_id, file_path, file_type, content_hash, symbols, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [indexId, projectId, relPath, path.extname(file), hash, JSON.stringify(symbols.map(s => s.name)), Date.now()]
  );

  return symbolCount;
}

export async function indexWorkspace(
  projectId: string,
  workspacePath: string,
  onProgress: (statusText: string) => void
): Promise<number> {
  let symbolCount = 0;

  try {
    onProgress('Scanning workspace files...');
    const allFiles: string[] = [];
    crawlDirectory(workspacePath, allFiles);

    if (allFiles.length > MAX_INDEXABLE_FILES) {
      console.warn(`Indexer: workspace has ${allFiles.length} indexable files, capping at ${MAX_INDEXABLE_FILES}.`);
    }
    const files = allFiles.slice(0, MAX_INDEXABLE_FILES);

    onProgress(`Found ${files.length} indexable files. Analysing...`);

    // Wrapped in one transaction() so the re-index is a single disk flush instead of thousands, and a failure partway rolls back the whole batch.
    databaseService.transaction(() => {
      // Clean up old entries for this project
      databaseService.run('DELETE FROM symbols WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM imports WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM [references] WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM components WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM services WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM routes WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM frontend_call_sites WHERE project_id = ?', [projectId]);
      databaseService.run('DELETE FROM project_index WHERE project_id = ?', [projectId]);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relPath = path.relative(workspacePath, file).replace(/\\/g, '/');
        onProgress(`Indexing (${i + 1}/${files.length}): ${path.basename(file)}`);

        try {
          const content = fs.readFileSync(file, 'utf-8');
          symbolCount += parseAndPersistFile(projectId, file, relPath, content);
        } catch (err) {
          console.error(`Failed to parse file: ${file}`, err);
        }
      }
    });

  } catch (err) {
    console.error('Indexing failed:', err);
    throw err;
  }

  return symbolCount;
}

// Single-file counterpart to indexWorkspace, used on file save; deletes just this file's rows then re-parses, or clears rows and returns 0 for a deleted/unparsable file.
export function reindexFile(projectId: string, workspacePath: string, filePath: string): number {
  const relPath = path.relative(workspacePath, filePath).replace(/\\/g, '/');

  return databaseService.transaction(() => {
    databaseService.run('DELETE FROM symbols WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM imports WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM [references] WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM components WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM services WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM routes WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM frontend_call_sites WHERE project_id = ? AND file_path = ?', [projectId, relPath]);
    databaseService.run('DELETE FROM project_index WHERE project_id = ? AND file_path = ?', [projectId, relPath]);

    if (!PARSABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || !fs.existsSync(filePath)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return parseAndPersistFile(projectId, filePath, relPath, content);
    } catch (err) {
      console.error(`Failed to reindex file: ${filePath}`, err);
      return 0;
    }
  });
}

export function crawlDirectory(dir: string, fileList: string[]) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.has(item)) {
        crawlDirectory(fullPath, fileList);
      }
    } else {
      const ext = path.extname(item).toLowerCase();
      if (PARSABLE_EXTENSIONS.has(ext)) {
        fileList.push(fullPath);
      }
    }
  }
}

// Regex AST parser
function parseSymbols(content: string, filePath: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');
  const isTsOrJs = /\.[jt]sx?$/.test(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (isTsOrJs) {
      // 1. Classes
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[1];
        const isService = name.toLowerCase().includes('service') || lines[Math.max(0, i - 1)].includes('@Injectable');
        symbols.push({
          name,
          kind: isService ? 'service' : 'class',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
        continue;
      }

      // 2. React Components
      // const MyComponent: React.FC = ...
      const componentFC = line.match(/(?:export\s+)?const\s+([A-Z]\w*)\s*:\s*(?:React\.)?(?:FC|FunctionComponent|Component)/);
      if (componentFC) {
        const name = componentFC[1];
        symbols.push({
          name,
          kind: 'component',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
        continue;
      }

      // 3. standard functions / arrows
      const funcMatch = line.match(/(?:export\s+)?function\s+(\w+)/);
      if (funcMatch) {
        const name = funcMatch[1];
        const isComp = /^[A-Z]/.test(name) && (content.includes('return (') || content.includes('<div') || content.includes('JSX'));
        symbols.push({
          name,
          kind: isComp ? 'component' : 'function',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
        continue;
      }

      const arrowMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/);
      if (arrowMatch) {
        const name = arrowMatch[1];
        const isComp = /^[A-Z]/.test(name) && (content.includes('return (') || content.includes('<div') || content.includes('JSX'));
        symbols.push({
          name,
          kind: isComp ? 'component' : 'function',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
      }
    } else if (filePath.endsWith('.py')) {
      // Python parsing
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[1];
        symbols.push({
          name,
          kind: 'class',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
        continue;
      }

      const defMatch = line.match(/^\s*def\s+(\w+)/);
      if (defMatch) {
        const name = defMatch[1];
        symbols.push({
          name,
          kind: 'function',
          line: lineNum,
          column: line.indexOf(name) + 1
        });
      }
    }
  }

  return symbols;
}

function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // import { A, B } from 'C'
    const importMatch = line.match(/import\s+(?:([\w*\s,{}]+)\s+from\s+)?['"`]([^'"`]+)['"`]/);
    if (importMatch) {
      const moduleName = importMatch[2];
      const rawSymbols = importMatch[1] || '';
      const symbols = rawSymbols
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('*'));
      
      imports.push({ moduleName, symbols });
    }
  }

  return imports;
}

function parseRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // router.get('/users', handler)
    const routeMatch = line.match(/(?:router|app)\.(get|post|put|delete)\(\s*['"`]([^'"`]+)['"`]\s*,\s*([\w\d_$]+)/i);
    if (routeMatch) {
      routes.push({
        method: routeMatch[1],
        pattern: routeMatch[2],
        handler: routeMatch[3],
        line: i + 1
      });
    }
  }

  return routes;
}

// Frontend API call-site detector — deliberately looser than parseRoutes since fetch/axios calls don't have a trailing named handler; heuristic line-based string matching, not URL/request resolution.
function parseCallSites(content: string): CallSiteInfo[] {
  const callSites: CallSiteInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fetchMatch = line.match(/fetch\(\s*['"`]([^'"`]+)['"`]/);
    if (fetchMatch) {
      const methodMatch = line.match(/method\s*:\s*['"`](get|post|put|delete|patch)['"`]/i);
      callSites.push({
        method: (methodMatch ? methodMatch[1] : 'get').toLowerCase(),
        urlPattern: fetchMatch[1],
        line: i + 1
      });
      continue;
    }

    const axiosMatch = line.match(/axios\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/i);
    if (axiosMatch) {
      callSites.push({
        method: axiosMatch[1].toLowerCase(),
        urlPattern: axiosMatch[2],
        line: i + 1
      });
    }
  }

  return callSites;
}
