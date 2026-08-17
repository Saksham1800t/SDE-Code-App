import { contextBridge, ipcRenderer } from 'electron';
import { createIpcInvokerFactory } from '../platform/ipc';
import type { GitIpcContract, FsIpcContract, DbIpcContract, AiIpcContract, AgentIpcContract, ExtensionContributionsIpcContract, ClipboardIpcContract, AgentToolCallEvent, AgentFileChange, AgentApprovalRequest, SnippetsIpcContract, ExtensionMarketplaceIpcContract, SearchIpcContract, PortsIpcContract, PortEntry, TerminalIpcContract, GitHubIpcContract, McpIpcContract, ProjectIndexerIpcContract, CodeMapIpcContract, SecureStoreIpcContract, LspIpcContract, LspMessageEvent, LspRpcMessage, DapIpcContract, DapMessageEvent, DapMessage, ExternalAgentIpcContract, NotebookIpcContract, NotebookKernelStatus } from '@sde-code/protocol';
import type { UpdaterStatus } from '../shared/updaterTypes';

const gitInvoker = createIpcInvokerFactory<GitIpcContract>();
const fsInvoker = createIpcInvokerFactory<FsIpcContract>();
const dbInvoker = createIpcInvokerFactory<DbIpcContract>();
const aiInvoker = createIpcInvokerFactory<AiIpcContract>();
const agentInvoker = createIpcInvokerFactory<AgentIpcContract>();
const extensionsInvoker = createIpcInvokerFactory<ExtensionContributionsIpcContract>();
const clipboardInvoker = createIpcInvokerFactory<ClipboardIpcContract>();
const secureStoreInvoker = createIpcInvokerFactory<SecureStoreIpcContract>();
const snippetsInvoker = createIpcInvokerFactory<SnippetsIpcContract>();
const extensionMarketplaceInvoker = createIpcInvokerFactory<ExtensionMarketplaceIpcContract>();
const searchInvoker = createIpcInvokerFactory<SearchIpcContract>();
const portsInvoker = createIpcInvokerFactory<PortsIpcContract>();
const terminalInvoker = createIpcInvokerFactory<TerminalIpcContract>();
const githubInvoker = createIpcInvokerFactory<GitHubIpcContract>();
const mcpInvoker = createIpcInvokerFactory<McpIpcContract>();
const indexerInvoker = createIpcInvokerFactory<ProjectIndexerIpcContract>();
const codeMapInvoker = createIpcInvokerFactory<CodeMapIpcContract>();
const lspInvoker = createIpcInvokerFactory<LspIpcContract>();
const externalAgentInvoker = createIpcInvokerFactory<ExternalAgentIpcContract>();
const dapInvoker = createIpcInvokerFactory<DapIpcContract>();
const notebookInvoker = createIpcInvokerFactory<NotebookIpcContract>();

// Hoisted to a const purely so its real shape can be captured as an exported type below — zero runtime effect since `export type` is fully erased.
const api = {
  // AI Queries — ai:query is typed against AiIpcContract; ai:abort/ai:chunk/ai:err stay on the original send/on pattern. Every push payload now carries the session id options.sessionId was queried with (see AiQueryOptions.sessionId's doc comment) — callers filter by it so concurrent sessions (Parallel Agent Threads) never see each other's chunks.
  queryAI: aiInvoker('ai:query'),
  onAIChunk: (callback: (sessionId: string, chunk: string) => void) => {
    const listener = (_event: any, payload: { sessionId: string; text: string }) => callback(payload.sessionId, payload.text);
    ipcRenderer.on('ai:chunk', listener);
    return () => { ipcRenderer.off('ai:chunk', listener); };
  },
  onAIErr: (callback: (sessionId: string, err: string) => void) => {
    const listener = (_event: any, payload: { sessionId: string; message: string }) => callback(payload.sessionId, payload.message);
    ipcRenderer.on('ai:err', listener);
    return () => { ipcRenderer.off('ai:err', listener); };
  },
  abortAI: (sessionId?: string) => ipcRenderer.send('ai:abort', sessionId),
  completeInlineAI: aiInvoker('ai:completeInline'),
  testAIConnection: aiInvoker('ai:testConnection'),
  readClipboardText: clipboardInvoker('clipboard:readText'),

  // Encrypted-at-rest key/value storage (Electron safeStorage-backed), used for auth tokens instead of plain localStorage.
  secureStoreSet: secureStoreInvoker('secureStore:set'),
  secureStoreGet: secureStoreInvoker('secureStore:get'),
  secureStoreDelete: secureStoreInvoker('secureStore:delete'),

  // Agent Mode — queryAgent is invoke/handle-shaped; ai:abort above is reused to cancel a run; the rest are push events like onAIChunk/onAIErr, all session-scoped the same way.
  queryAgent: agentInvoker('ai:agentQuery'),
  onAgentChunk: (callback: (sessionId: string, chunk: string) => void) => {
    const listener = (_event: any, payload: { sessionId: string; text: string }) => callback(payload.sessionId, payload.text);
    ipcRenderer.on('ai:agentChunk', listener);
    return () => { ipcRenderer.off('ai:agentChunk', listener); };
  },
  onAgentToolCall: (callback: (sessionId: string, info: AgentToolCallEvent) => void) => {
    const listener = (_event: any, payload: { sessionId: string; info: AgentToolCallEvent }) => callback(payload.sessionId, payload.info);
    ipcRenderer.on('ai:agentToolCall', listener);
    return () => { ipcRenderer.off('ai:agentToolCall', listener); };
  },
  onAgentWorkingSetUpdate: (callback: (sessionId: string, changes: AgentFileChange[]) => void) => {
    const listener = (_event: any, payload: { sessionId: string; changes: AgentFileChange[] }) => callback(payload.sessionId, payload.changes);
    ipcRenderer.on('ai:agentWorkingSetUpdate', listener);
    return () => { ipcRenderer.off('ai:agentWorkingSetUpdate', listener); };
  },
  // run_terminal_command approval round trip: onAgentApprovalRequest is a push event; respondAgentApproval is fire-and-forget the other way, like abortAI. requestId alone (not sessionId) is what round-trips back via respondAgentApproval, since AiService's pendingApprovals is keyed by requestId.
  onAgentApprovalRequest: (callback: (sessionId: string, request: AgentApprovalRequest) => void) => {
    const listener = (_event: any, payload: { sessionId: string; request: AgentApprovalRequest }) => callback(payload.sessionId, payload.request);
    ipcRenderer.on('ai:agentApprovalRequest', listener);
    return () => { ipcRenderer.off('ai:agentApprovalRequest', listener); };
  },
  respondAgentApproval: (requestId: string, approved: boolean) => ipcRenderer.send('ai:agentApprovalResponse', requestId, approved),
  onAgentErr: (callback: (sessionId: string, err: string) => void) => {
    const listener = (_event: any, payload: { sessionId: string; message: string }) => callback(payload.sessionId, payload.message);
    ipcRenderer.on('ai:agentErr', listener);
    return () => { ipcRenderer.off('ai:agentErr', listener); };
  },
  onAgentDone: (callback: (sessionId: string) => void) => {
    const listener = (_event: any, payload: { sessionId: string }) => callback(payload.sessionId);
    ipcRenderer.on('ai:agentDone', listener);
    return () => { ipcRenderer.off('ai:agentDone', listener); };
  },

  // Workspace/File Management — typed against FsIpcContract (@sde-code/protocol).
  openFolder: fsInvoker('fs:openFolder'),
  getProjectTrust: fsInvoker('fs:getProjectTrust'),
  getRecentProjects: fsInvoker('fs:getRecentProjects'),
  showSaveWorkspaceDialog: fsInvoker('fs:showSaveWorkspaceDialog'),
  showOpenWorkspaceDialog: fsInvoker('fs:showOpenWorkspaceDialog'),
  setProjectTrust: fsInvoker('fs:setProjectTrust'),
  readDir: fsInvoker('fs:readDir'),
  readFile: fsInvoker('fs:readFile'),
  writeFile: fsInvoker('fs:writeFile'),
  createFile: fsInvoker('fs:createFile'),
  createDirectory: fsInvoker('fs:createDirectory'),
  deleteFile: fsInvoker('fs:deleteFile'),
  deletePath: fsInvoker('fs:deletePath'),
  renamePath: fsInvoker('fs:renamePath'),
  revealInExplorer: fsInvoker('fs:revealInExplorer'),
  saveFileSnapshot: fsInvoker('fs:saveFileSnapshot'),
  getFileHistory: fsInvoker('fs:getFileHistory'),
  getFileSnapshotContent: fsInvoker('fs:getFileSnapshotContent'),
  minimizeWindow: () => ipcRenderer.send('win:minimize'),
  maximizeWindow: () => ipcRenderer.send('win:maximize'),
  toggleDevTools: () => ipcRenderer.send('win:toggleDevTools'),
  // Keeps the native title-bar-overlay buttons in sync with the active theme; Electron's titleBarOverlay can only be set from the main process, so this is fire-and-forget, not a typed invoker.
  setTitleBarOverlay: (options: { color?: string; symbolColor?: string }) =>
    ipcRenderer.send('win:setTitleBarOverlay', options),

  // Git Integration — typed against GitIpcContract (@sde-code/protocol),
  // the same contract host/ipc.ts's handlers are checked against.
  gitStatus: gitInvoker('git:status'),
  gitInit: gitInvoker('git:init'),
  gitStage: gitInvoker('git:stage'),
  gitUnstage: gitInvoker('git:unstage'),
  gitStageAll: gitInvoker('git:stageAll'),
  gitUnstageAll: gitInvoker('git:unstageAll'),
  gitDiscardFile: gitInvoker('git:discardFile'),
  gitDiscardAll: gitInvoker('git:discardAll'),
  gitCommit: gitInvoker('git:commit'),
  gitUndoLastCommit: gitInvoker('git:undoLastCommit'),
  gitAmendLastCommit: gitInvoker('git:amendLastCommit'),
  gitPush: gitInvoker('git:push'),
  gitPull: gitInvoker('git:pull'),
  gitFetch: gitInvoker('git:fetch'),
  gitDiff: gitInvoker('git:diff'),
  gitGetBranches: gitInvoker('git:getBranches'),
  gitCreateBranch: gitInvoker('git:createBranch'),
  gitCheckoutBranch: gitInvoker('git:checkoutBranch'),
  gitDeleteBranch: gitInvoker('git:deleteBranch'),
  gitRenameBranch: gitInvoker('git:renameBranch'),
  gitPublishBranch: gitInvoker('git:publishBranch'),
  gitMergeBranch: gitInvoker('git:mergeBranch'),
  gitGetLog: gitInvoker('git:getLog'),
  gitGetRemotes: gitInvoker('git:getRemotes'),
  gitStashPush: gitInvoker('git:stashPush'),
  gitStashPop: gitInvoker('git:stashPop'),
  gitStashDrop: gitInvoker('git:stashDrop'),
  gitStashList: gitInvoker('git:stashList'),
  gitGetMergeStatus: gitInvoker('git:getMergeStatus'),
  gitGetStagedDiff: gitInvoker('git:getStagedDiff'),
  gitGetWorkingTreeDiff: gitInvoker('git:getWorkingTreeDiff'),
  gitApplyWorkingTreeDiff: gitInvoker('git:applyWorkingTreeDiff'),
  gitGetHeatmap: gitInvoker('git:getHeatmap'),
  gitGetRepoStats: gitInvoker('git:getRepoStats'),
  gitGetCommitFiles: gitInvoker('git:getCommitFiles'),
  gitGetCommitDiff: gitInvoker('git:getCommitDiff'),
  gitGetFileHotspots: gitInvoker('git:getFileHotspots'),
  gitGetCommitPatch: gitInvoker('git:getCommitPatch'),
  gitGetBranchDiff: gitInvoker('git:getBranchDiff'),
  gitGetBranchFileDiff: gitInvoker('git:getBranchFileDiff'),
  gitGetCommitGraph: gitInvoker('git:getCommitGraph'),
  gitDiscoverRepos: gitInvoker('git:discoverRepos'),
  gitCreateWorktree: gitInvoker('git:createWorktree'),
  gitRemoveWorktree: gitInvoker('git:removeWorktree'),
  gitGetFileCommitHistory: gitInvoker('git:getFileCommitHistory'),


  // Database — typed against DbIpcContract (@sde-code/protocol).
  getFlags: dbInvoker('db:getFlags'),
  setFlag: dbInvoker('db:setFlag'),
  clearWorkspaceFlagOverride: dbInvoker('db:clearWorkspaceFlagOverride'),
  getSettings: dbInvoker('db:getSettings'),
  setSetting: dbInvoker('db:setSetting'),
  getConversations: dbInvoker('db:getConversations'),
  saveConversation: dbInvoker('db:saveConversation'),
  deleteConversation: dbInvoker('db:deleteConversation'),
  getProjectRules: dbInvoker('db:getProjectRules'),
  saveProjectRule: dbInvoker('db:saveProjectRule'),
  setProjectRuleActive: dbInvoker('db:setProjectRuleActive'),
  deleteProjectRule: dbInvoker('db:deleteProjectRule'),
  getProjectMemories: dbInvoker('db:getProjectMemories'),
  saveProjectMemory: dbInvoker('db:saveProjectMemory'),
  deleteProjectMemory: dbInvoker('db:deleteProjectMemory'),
  getExtensions: dbInvoker('db:getExtensions'),
  setExtensionEnabled: dbInvoker('db:setExtensionEnabled'),
  saveExtension: dbInvoker('db:saveExtension'),
  deleteExtension: dbInvoker('db:deleteExtension'),
  getWorkspaceExtensionOverrides: dbInvoker('db:getWorkspaceExtensionOverrides'),
  setWorkspaceExtensionEnabled: dbInvoker('db:setWorkspaceExtensionEnabled'),
  clearWorkspaceExtensionOverride: dbInvoker('db:clearWorkspaceExtensionOverride'),
  getThemes: dbInvoker('db:getThemes'),
  saveTheme: dbInvoker('db:saveTheme'),

  // Commands & Keybindings
  getCommands: dbInvoker('db:getCommands'),
  getKeybindings: dbInvoker('db:getKeybindings'),
  setKeybinding: dbInvoker('db:setKeybinding'),
  resetKeybindings: dbInvoker('db:resetKeybindings'),
  getProfiles: dbInvoker('db:getProfiles'),
  createProfile: dbInvoker('db:createProfile'),
  renameProfile: dbInvoker('db:renameProfile'),
  deleteProfile: dbInvoker('db:deleteProfile'),

  // Extension contributions — deliberately separate names from getCommands/getThemes above so the renderer merges both sources rather than one shadowing the other.
  getExtensionCommands: extensionsInvoker('extensions:getCommands'),
  executeExtensionCommand: extensionsInvoker('extensions:executeCommand'),
  getExtensionStatusBarItems: extensionsInvoker('extensions:getStatusBarItems'),
  getExtensionThemes: extensionsInvoker('extensions:getThemes'),
  getWalkthroughs: extensionsInvoker('extensions:getWalkthroughs'),
  getExtensionLanguageServers: extensionsInvoker('extensions:getLanguageServers'),
  getExtensionDebugAdapters: extensionsInvoker('extensions:getDebugAdapters'),
  getExtensionLanguageDefinitions: extensionsInvoker('extensions:getLanguageDefinitions'),

  // Snippets
  getSnippetsForLanguage: snippetsInvoker('snippets:getForLanguage'),
  ensureUserSnippetFile: snippetsInvoker('snippets:ensureUserSnippetFile'),
  listUserSnippetFiles: snippetsInvoker('snippets:listUserSnippetFiles'),
  getUserSnippetFileContent: snippetsInvoker('snippets:getUserSnippetFileContent'),
  writeUserSnippetFileContent: snippetsInvoker('snippets:writeUserSnippetFileContent'),

  // Terminal Bridge
  createTerminal: (terminalId: string, cwd: string, extraPathEntries?: string[]) => ipcRenderer.send('terminal:create', terminalId, cwd, extraPathEntries),
  writeTerminal: (terminalId: string, data: string) => ipcRenderer.send('terminal:write', terminalId, data),
  resizeTerminal: (terminalId: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', terminalId, cols, rows),
  closeTerminal: (terminalId: string) => ipcRenderer.send('terminal:close', terminalId),
  onTerminalOutput: (callback: (eventData: { terminalId: string; data: string }) => void) => {
    const listener = (_event: any, eventData: { terminalId: string; data: string }) => callback(eventData);
    ipcRenderer.on('terminal:output', listener);
    return () => { ipcRenderer.off('terminal:output', listener); };
  },
  getPathExecutables: terminalInvoker('terminal:getPathExecutables'),

  // Language servers — request/response calls typed against LspIpcContract;
  // lspSend/onLspMessage are the untyped push pair, same shape as
  // writeTerminal/onTerminalOutput above (see LspService's own doc comment).
  lspEnsureServer: lspInvoker('lsp:ensureServer'),
  lspGetServerStates: lspInvoker('lsp:getServerStates'),
  lspIsLanguageSupported: lspInvoker('lsp:isLanguageSupported'),
  lspGetSemanticTokensLegend: lspInvoker('lsp:getSemanticTokensLegend'),
  lspSend: (language: string, workspaceRoot: string, message: LspRpcMessage) =>
    ipcRenderer.send('lsp:send', language, workspaceRoot, message),
  onLspMessage: (callback: (event: LspMessageEvent) => void) => {
    const listener = (_event: any, payload: LspMessageEvent) => callback(payload);
    ipcRenderer.on('lsp:message', listener);
    return () => { ipcRenderer.off('lsp:message', listener); };
  },

  // Debug sessions — same request/response-plus-push split as the language-server pair above.
  dapStartSession: dapInvoker('dap:startSession'),
  dapGetSessionStates: dapInvoker('dap:getSessionStates'),
  dapStopSession: dapInvoker('dap:stopSession'),
  dapSend: (sessionId: string, message: DapMessage) => ipcRenderer.send('dap:send', sessionId, message),
  onDapMessage: (callback: (event: DapMessageEvent) => void) => {
    const listener = (_event: any, payload: DapMessageEvent) => callback(payload);
    ipcRenderer.on('dap:message', listener);
    return () => { ipcRenderer.off('dap:message', listener); };
  },

  githubStartDeviceFlow: githubInvoker('github:startDeviceFlow'),
  githubPollForToken: githubInvoker('github:pollForToken'),
  githubSignOut: githubInvoker('github:signOut'),
  githubGetCurrentUser: githubInvoker('github:getCurrentUser'),
  githubListPullRequests: githubInvoker('github:listPullRequests'),
  githubListIssues: githubInvoker('github:listIssues'),
  githubGetPullRequest: githubInvoker('github:getPullRequest'),
  githubGetPullRequestFiles: githubInvoker('github:getPullRequestFiles'),
  githubGetFileContentAtRef: githubInvoker('github:getFileContentAtRef'),
  githubGetComments: githubInvoker('github:getComments'),
  githubPostComment: githubInvoker('github:postComment'),
  githubGetReviewComments: githubInvoker('github:getReviewComments'),
  githubSubmitReview: githubInvoker('github:submitReview'),

  mcpGetServers: mcpInvoker('mcp:getServers'),
  mcpSaveServer: mcpInvoker('mcp:saveServer'),
  mcpDeleteServer: mcpInvoker('mcp:deleteServer'),
  mcpGetServerStates: mcpInvoker('mcp:getServerStates'),
  mcpReconnectServer: mcpInvoker('mcp:reconnectServer'),

  // External Agents (Aider, Claude Code CLI, ...) — getConfigs/saveConfig/deleteConfig/run/cancel are all invoke/handle-shaped; the run's actual output arrives via the chunk/done/error push events below, keyed by runId (the value externalAgent:run's promise resolves with).
  externalAgentGetConfigs: externalAgentInvoker('externalAgent:getConfigs'),
  externalAgentSaveConfig: externalAgentInvoker('externalAgent:saveConfig'),
  externalAgentDeleteConfig: externalAgentInvoker('externalAgent:deleteConfig'),
  runExternalAgent: externalAgentInvoker('externalAgent:run'),
  cancelExternalAgentRun: externalAgentInvoker('externalAgent:cancel'),
  onExternalAgentChunk: (callback: (runId: string, text: string) => void) => {
    const listener = (_event: any, payload: { runId: string; text: string }) => callback(payload.runId, payload.text);
    ipcRenderer.on('externalAgent:chunk', listener);
    return () => { ipcRenderer.off('externalAgent:chunk', listener); };
  },
  onExternalAgentDone: (callback: (runId: string, exitCode: number | null) => void) => {
    const listener = (_event: any, payload: { runId: string; exitCode: number | null }) => callback(payload.runId, payload.exitCode);
    ipcRenderer.on('externalAgent:done', listener);
    return () => { ipcRenderer.off('externalAgent:done', listener); };
  },
  onExternalAgentError: (callback: (runId: string, message: string) => void) => {
    const listener = (_event: any, payload: { runId: string; message: string }) => callback(payload.runId, payload.message);
    ipcRenderer.on('externalAgent:error', listener);
    return () => { ipcRenderer.off('externalAgent:error', listener); };
  },

  // Notebook kernels — startKernel/executeCell/interruptKernel/restartKernel/stopKernel are all invoke/handle-shaped; a cell's actual output arrives via the cellOutput/cellDone/kernelStatus push events below, keyed by kernelId (the value startKernel's promise resolves with).
  startNotebookKernel: notebookInvoker('notebook:startKernel'),
  executeNotebookCell: notebookInvoker('notebook:executeCell'),
  interruptNotebookKernel: notebookInvoker('notebook:interruptKernel'),
  restartNotebookKernel: notebookInvoker('notebook:restartKernel'),
  stopNotebookKernel: notebookInvoker('notebook:stopKernel'),
  onNotebookCellOutput: (callback: (kernelId: string, executionId: string, name: 'stdout' | 'stderr', text: string) => void) => {
    const listener = (_event: any, payload: { kernelId: string; executionId: string; name: 'stdout' | 'stderr'; text: string }) =>
      callback(payload.kernelId, payload.executionId, payload.name, payload.text);
    ipcRenderer.on('notebook:cellOutput', listener);
    return () => { ipcRenderer.off('notebook:cellOutput', listener); };
  },
  onNotebookCellDone: (callback: (kernelId: string, executionId: string, status: 'ok' | 'error', error: string | null) => void) => {
    const listener = (_event: any, payload: { kernelId: string; executionId: string; status: 'ok' | 'error'; error: string | null }) =>
      callback(payload.kernelId, payload.executionId, payload.status, payload.error);
    ipcRenderer.on('notebook:cellDone', listener);
    return () => { ipcRenderer.off('notebook:cellDone', listener); };
  },
  onNotebookKernelStatus: (callback: (kernelId: string, status: NotebookKernelStatus) => void) => {
    const listener = (_event: any, payload: { kernelId: string; status: NotebookKernelStatus }) => callback(payload.kernelId, payload.status);
    ipcRenderer.on('notebook:kernelStatus', listener);
    return () => { ipcRenderer.off('notebook:kernelStatus', listener); };
  },

  // Project Indexer — 'project:index' stays a raw ipcMain.handle in host/ipc.ts since it needs `event` to resolve the window for progress push events.
  indexProject: (projectId: string, workspacePath: string): Promise<number> =>
    ipcRenderer.invoke('project:index', { projectId, workspacePath }),
  onIndexProgress: (callback: (statusText: string) => void) => {
    const listener = (_event: any, statusText: string) => callback(statusText);
    ipcRenderer.on('project:index-progress', listener);
    return () => { ipcRenderer.off('project:index-progress', listener); };
  },
  reindexFile: indexerInvoker('project:reindexFile'),

  // Code Map + AI Impact Analysis — typed against CodeMapIpcContract.
  getCodeGraph: codeMapInvoker('codemap:getGraph'),
  getImpact: codeMapInvoker('codemap:getImpact'),

  // Extension marketplace — typed against ExtensionMarketplaceIpcContract.
  downloadExtension: extensionMarketplaceInvoker('extensionMarketplace:downloadInstall'),
  scaffoldAndPublishExtension: extensionMarketplaceInvoker('extensionMarketplace:scaffoldPublish'),

  // Search — typed against SearchIpcContract (@sde-code/protocol).
  searchInFiles: searchInvoker('search:inFiles'),
  listAllFiles: searchInvoker('search:listAllFiles'),
  replaceInFiles: searchInvoker('search:replaceInFiles'),
  searchWorkspaceSymbols: searchInvoker('search:workspaceSymbols'),

  // Ports panel — ports:detected/ports:closed are push events, same pattern as onTerminalOutput above.
  listPorts: portsInvoker('ports:list'),
  addManualPort: portsInvoker('ports:addManual'),
  removePort: portsInvoker('ports:remove'),
  setPortLabel: portsInvoker('ports:setLabel'),
  startTunnel: portsInvoker('ports:startTunnel'),
  stopTunnel: portsInvoker('ports:stopTunnel'),
  openExternal: portsInvoker('ports:openExternal'),
  onPortDetected: (callback: (entry: PortEntry) => void) => {
    const listener = (_event: any, entry: PortEntry) => callback(entry);
    ipcRenderer.on('ports:detected', listener);
    return () => { ipcRenderer.off('ports:detected', listener); };
  },
  onPortClosed: (callback: (port: number) => void) => {
    const listener = (_event: any, port: number) => callback(port);
    ipcRenderer.on('ports:closed', listener);
    return () => { ipcRenderer.off('ports:closed', listener); };
  },

  // Output panel's "Main Process" channel — log:entry is a push event, same pattern as onPortDetected above.
  onLogEntry: (callback: (line: string) => void) => {
    const listener = (_event: any, line: string) => callback(line);
    ipcRenderer.on('log:entry', listener);
    return () => { ipcRenderer.off('log:entry', listener); };
  },

  // Auto-update — updater:status is a push event, same pattern as onPortDetected above.
  checkForUpdates: (manual?: boolean) => ipcRenderer.invoke('updater:check', manual),
  quitAndInstallUpdate: () => ipcRenderer.send('updater:quitAndInstall'),
  onUpdaterStatus: (callback: (status: UpdaterStatus) => void) => {
    const listener = (_event: any, status: UpdaterStatus) => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => { ipcRenderer.off('updater:status', listener); };
  },

  // OS Platform
  platform: process.platform
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
