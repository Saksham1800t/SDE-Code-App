import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { registerAllLspLanguageClients } from './lsp';
import { loadExtensionDebugLanguages } from './debug/debugSession';
import { registerExtensionLanguages } from './languages/registerExtensionLanguages';

// Must run before the first Editor mounts — otherwise the loader defaults to fetching Monaco from a CDN instead of the local package.
loader.config({ monaco });

// Without these dedicated-worker bundles, Monaco runs everything on the main thread and silently drops languages needing a worker (notably TS/JS).
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// monaco.languages.register*Provider is a global registration, not per-editor-instance — must run exactly once, same lifetime guarantee as the config above. Built-ins register synchronously below; extension-contributed languages/servers/adapters register a moment later once their (independent, parallel) IPC round-trips resolve — fine, since no editor could have requested anything for a language nothing knew about yet either way, and Monaco's provider registry (registerCompletionItemProvider etc.) isn't gated on languages.register() having run first for that id.
void registerExtensionLanguages();
void registerAllLspLanguageClients();
void loadExtensionDebugLanguages();
