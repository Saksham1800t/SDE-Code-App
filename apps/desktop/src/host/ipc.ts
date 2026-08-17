import fs from 'fs';
import { ipcMain, dialog, BrowserWindow, clipboard, shell, app, safeStorage } from 'electron';
import { createTerminalSession, writeTerminalInput, resizeTerminalSession, closeTerminalSession } from '../main/services/terminal';
import { getPathExecutables } from '../main/services/pathExecutables';
import { indexWorkspace, reindexFile } from '../main/services/indexer';
import { listPorts, addManualPort, removePort, setPortLabel, startTunnel, stopTunnel } from '../main/services/ports';
import { checkForUpdates, quitAndInstall } from '../main/services/updater';
import { createIpcHandlerRegistrar } from '../platform/ipc';
import type { GitIpcContract, FsIpcContract, DbIpcContract, ExtensionContributionsIpcContract, AiIpcContract, ClipboardIpcContract, SnippetsIpcContract, ExtensionMarketplaceIpcContract, SearchIpcContract, PortsIpcContract, TerminalIpcContract, GitHubIpcContract, McpIpcContract, ProjectIndexerIpcContract, CodeMapIpcContract, SecureStoreIpcContract, LspIpcContract, LspRpcMessage, DapIpcContract, DapMessage, ExternalAgentIpcContract, NotebookIpcContract } from '@sde-code/protocol';
import { gitService, fileSystemService, databaseService, aiService, searchService, commandRegistry, statusBarRegistry, themeRegistry, snippetsService, snippetsRegistry, walkthroughsRegistry, extensionMarketplaceService, githubService, mcpService, impactAnalysisService, lspService, languageServerRegistry, dapService, debugAdapterRegistry, languageDefinitionRegistry, externalAgentService, notebookKernelService } from './services';
import path from 'path';

const registerGitHandler = createIpcHandlerRegistrar<GitIpcContract>();
const registerFsHandler = createIpcHandlerRegistrar<FsIpcContract>();
const registerDbHandler = createIpcHandlerRegistrar<DbIpcContract>();
const registerExtensionsHandler = createIpcHandlerRegistrar<ExtensionContributionsIpcContract>();
const registerAiHandler = createIpcHandlerRegistrar<AiIpcContract>();
const registerClipboardHandler = createIpcHandlerRegistrar<ClipboardIpcContract>();
const registerSnippetsHandler = createIpcHandlerRegistrar<SnippetsIpcContract>();
const registerExtensionMarketplaceHandler = createIpcHandlerRegistrar<ExtensionMarketplaceIpcContract>();
const registerSearchHandler = createIpcHandlerRegistrar<SearchIpcContract>();
const registerPortsHandler = createIpcHandlerRegistrar<PortsIpcContract>();
const registerIndexerHandler = createIpcHandlerRegistrar<ProjectIndexerIpcContract>();
const registerCodeMapHandler = createIpcHandlerRegistrar<CodeMapIpcContract>();
const registerTerminalHandler = createIpcHandlerRegistrar<TerminalIpcContract>();
const registerGitHubHandler = createIpcHandlerRegistrar<GitHubIpcContract>();
const registerMcpHandler = createIpcHandlerRegistrar<McpIpcContract>();
const registerSecureStoreHandler = createIpcHandlerRegistrar<SecureStoreIpcContract>();
const registerLspHandler = createIpcHandlerRegistrar<LspIpcContract>();
const registerDapHandler = createIpcHandlerRegistrar<DapIpcContract>();
const registerExternalAgentHandler = createIpcHandlerRegistrar<ExternalAgentIpcContract>();
const registerNotebookHandler = createIpcHandlerRegistrar<NotebookIpcContract>();

// secure-store.json holds opaque safeStorage-encrypted blobs keyed by caller-chosen strings, falling back to plaintext only where safeStorage is unavailable.
function secureStorePath(): string {
  return path.join(app.getPath('userData'), 'secure-store.json');
}

function readSecureStoreFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secureStorePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeSecureStoreFile(store: Record<string, string>): void {
  fs.writeFileSync(secureStorePath(), JSON.stringify(store));
}

export function registerIPCHandlers() {
  // Terminal commands
  ipcMain.on('terminal:create', (event, terminalId: string, cwd: string, extraPathEntries?: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) createTerminalSession(win, terminalId, cwd, extraPathEntries ?? []);
  });

  ipcMain.on('terminal:write', (_event, terminalId: string, data: string) => {
    writeTerminalInput(terminalId, data);
  });

  ipcMain.on('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    resizeTerminalSession(terminalId, cols, rows);
  });

  ipcMain.on('terminal:close', (_event, terminalId: string) => {
    closeTerminalSession(terminalId);
  });

  registerTerminalHandler('terminal:getPathExecutables', () => getPathExecutables());

  // Language servers — typed against LspIpcContract for the request/response
  // calls; lsp:send/lsp:message stay on the untyped push pattern like
  // terminal:write/terminal:output, since the LSP protocol itself is a
  // continuous bidirectional message stream, not discrete request/response
  // calls (see LspService's own doc comment for why).
  registerLspHandler('lsp:ensureServer', (language, workspaceRoot) => lspService.ensureServer(language, workspaceRoot));
  registerLspHandler('lsp:getServerStates', async () => lspService.getServerStates());
  registerLspHandler('lsp:isLanguageSupported', (language) => lspService.isLanguageSupported(language));
  registerLspHandler('lsp:getSemanticTokensLegend', async (language, workspaceRoot) => lspService.getSemanticTokensLegend(language, workspaceRoot));
  ipcMain.on('lsp:send', (_event, language: string, workspaceRoot: string, message: LspRpcMessage) => {
    lspService.sendToServer(language, workspaceRoot, message);
  });

  // Debug sessions — same request/response-plus-push split as LSP above, but DapService owns none of the DAP protocol itself (see its doc comment); every message including `initialize` goes over dap:send/dap:message.
  registerDapHandler('dap:startSession', (sessionId, language, program, cwd) => dapService.startSession(sessionId, language, program, cwd));
  registerDapHandler('dap:getSessionStates', async () => dapService.getSessionStates());
  registerDapHandler('dap:stopSession', async (sessionId) => dapService.stopSession(sessionId));
  ipcMain.on('dap:send', (_event, sessionId: string, message: DapMessage) => {
    dapService.sendToSession(sessionId, message);
  });

  // GitHub — typed against GitHubIpcContract (@sde-code/protocol).
  registerGitHubHandler('github:startDeviceFlow', (clientId) => githubService.startDeviceFlow(clientId));
  registerGitHubHandler('github:pollForToken', (clientId, deviceCode) => githubService.pollForToken(clientId, deviceCode));
  registerGitHubHandler('github:signOut', () => githubService.signOut());
  registerGitHubHandler('github:getCurrentUser', () => githubService.getCurrentUser());
  registerGitHubHandler('github:listPullRequests', (owner, repo) => githubService.listPullRequests(owner, repo));
  registerGitHubHandler('github:listIssues', (owner, repo) => githubService.listIssues(owner, repo));
  registerGitHubHandler('github:getPullRequest', (owner, repo, number) => githubService.getPullRequest(owner, repo, number));
  registerGitHubHandler('github:getPullRequestFiles', (owner, repo, number) => githubService.getPullRequestFiles(owner, repo, number));
  registerGitHubHandler('github:getFileContentAtRef', (owner, repo, filePath, ref) => githubService.getFileContentAtRef(owner, repo, filePath, ref));
  registerGitHubHandler('github:getComments', (owner, repo, number) => githubService.getComments(owner, repo, number));
  registerGitHubHandler('github:postComment', (owner, repo, number, body) => githubService.postComment(owner, repo, number, body));
  registerGitHubHandler('github:getReviewComments', (owner, repo, number) => githubService.getReviewComments(owner, repo, number));
  registerGitHubHandler('github:submitReview', (owner, repo, number, commitSha, event, body, comments) =>
    githubService.submitReview(owner, repo, number, commitSha, event, body, comments));

  // MCP (Model Context Protocol) — typed against McpIpcContract.
  registerMcpHandler('mcp:getServers', async () => mcpService.getServers());
  registerMcpHandler('mcp:saveServer', (config) => mcpService.saveServer(config));
  registerMcpHandler('mcp:deleteServer', (id) => mcpService.deleteServer(id));
  registerMcpHandler('mcp:getServerStates', async () => mcpService.getServerStates());
  registerMcpHandler('mcp:reconnectServer', (id) => mcpService.reconnectServer(id));

  // External Agents (Aider, Claude Code CLI, ...) — getConfigs/saveConfig/deleteConfig are typed against ExternalAgentIpcContract; run/cancel are registered directly (like ai:query below) since run needs `event` to resolve the originating window for the externalAgent:chunk/done/error push events.
  registerExternalAgentHandler('externalAgent:getConfigs', async () => externalAgentService.getConfigs());
  registerExternalAgentHandler('externalAgent:saveConfig', (config) => externalAgentService.saveConfig(config));
  registerExternalAgentHandler('externalAgent:deleteConfig', (id) => externalAgentService.deleteConfig(id));

  ipcMain.handle('externalAgent:run', (event, configId: string, prompt: string, workspacePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const runId = externalAgentService.run(configId, prompt, workspacePath, {
      onChunk: (text) => win?.webContents.send('externalAgent:chunk', { runId, text }),
      onDone: (exitCode) => win?.webContents.send('externalAgent:done', { runId, exitCode }),
      onError: (message) => win?.webContents.send('externalAgent:error', { runId, message }),
    });
    return { runId };
  });

  ipcMain.handle('externalAgent:cancel', (_event, runId: string) => {
    externalAgentService.cancel(runId);
  });

  // Notebook kernels — startKernel is registered directly (not via the typed registrar) since it needs `event` to resolve the originating window for the notebook:cellOutput/cellDone/kernelStatus push events, same reasoning as externalAgent:run above. The sink built here is stored on the kernel for its whole lifetime, so executeCell/interruptKernel/restartKernel/stopKernel need no window access of their own and go through the typed registrar.
  ipcMain.handle('notebook:startKernel', (event, language: string, workspacePath: string, interpreterPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const kernelId = notebookKernelService.startKernel(language, workspacePath, {
      onStream: (executionId, name, text) => win?.webContents.send('notebook:cellOutput', { kernelId, executionId, name, text }),
      onDone: (executionId, status, error) => win?.webContents.send('notebook:cellDone', { kernelId, executionId, status, error }),
      onStatus: (status) => win?.webContents.send('notebook:kernelStatus', { kernelId, status }),
    }, interpreterPath);
    return { kernelId };
  });

  registerNotebookHandler('notebook:executeCell', async (kernelId, code) => ({ executionId: notebookKernelService.executeCell(kernelId, code) }));
  registerNotebookHandler('notebook:interruptKernel', async (kernelId) => { notebookKernelService.interruptKernel(kernelId); });
  registerNotebookHandler('notebook:restartKernel', async (kernelId, language, workspacePath, interpreterPath) =>
    notebookKernelService.restartKernel(kernelId, language, workspacePath, interpreterPath),
  );
  registerNotebookHandler('notebook:stopKernel', async (kernelId) => { notebookKernelService.stopKernel(kernelId); });

  // AI Queries — registered directly (not via the typed registrar) because it needs `event` to resolve the originating window; ai:abort/ai:chunk/ai:err are push events outside the typed contract. Every push payload carries sessionId (falling back to 'unscoped' only as defense-in-depth against a caller that forgot to set options.sessionId — every real IPC caller always does) so the renderer can route chunks to the right thread instead of every listener seeing every session's output.
  ipcMain.handle('ai:query', async (event, provider: string, model: string, prompt: string, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const sessionId = options.sessionId ?? 'unscoped';
      await aiService.query(provider, model, prompt, options, {
        onChunk: (text) => win.webContents.send('ai:chunk', { sessionId, text }),
        onError: (message) => win.webContents.send('ai:err', { sessionId, message }),
      });
    }
  });

  ipcMain.on('ai:abort', (_event, sessionId?: string) => {
    aiService.abort(sessionId);
  });

  registerAiHandler('ai:completeInline', (request) => aiService.completeInline(request));
  registerAiHandler('ai:testConnection', (provider) => aiService.testConnection(provider));

  // Agent Mode — same reasoning as ai:query above; ai:abort is reused as-is to cancel an in-progress agent run (now session-scoped).
  ipcMain.handle('ai:agentQuery', async (event, provider: string, model: string, prompt: string, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const sessionId = options.sessionId ?? 'unscoped';
      await aiService.agentQuery(provider, model, prompt, options, {
        onChunk: (text) => win.webContents.send('ai:agentChunk', { sessionId, text }),
        onToolCall: (info) => win.webContents.send('ai:agentToolCall', { sessionId, info }),
        onWorkingSetUpdate: (changes) => win.webContents.send('ai:agentWorkingSetUpdate', { sessionId, changes }),
        onApprovalRequest: (request) => win.webContents.send('ai:agentApprovalRequest', { sessionId, request }),
        onError: (message) => win.webContents.send('ai:agentErr', { sessionId, message }),
        onDone: () => win.webContents.send('ai:agentDone', { sessionId }),
      });
    }
  });

  // The renderer's Approve/Deny response, routed to AiService's pendingApprovals; a no-op if the requestId is already gone.
  ipcMain.on('ai:agentApprovalResponse', (_event, requestId: string, approved: boolean) => {
    aiService.resolvePendingApproval(requestId, approved);
  });

  // Clipboard — only a read channel exists; writes already work fine via the renderer's Async Clipboard API / Monaco's built-in actions.
  registerClipboardHandler('clipboard:readText', async () => clipboard.readText());

  // Secure storage — see SecureStoreIpcContract (@sde-code/protocol).
  registerSecureStoreHandler('secureStore:set', async (key, value) => {
    const store = readSecureStoreFile();
    store[key] = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(value).toString('base64')
      : value;
    writeSecureStoreFile(store);
  });
  registerSecureStoreHandler('secureStore:get', async (key) => {
    const raw = readSecureStoreFile()[key];
    if (raw === undefined) return null;
    if (!safeStorage.isEncryptionAvailable()) return raw;
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return null;
    }
  });
  registerSecureStoreHandler('secureStore:delete', async (key) => {
    const store = readSecureStoreFile();
    delete store[key];
    writeSecureStoreFile(store);
  });

  // Git Operations — typed against GitIpcContract, checked at compile time against the same contract the preload invoker uses.
  registerGitHandler('git:status', (dir) => gitService.getStatus(dir));
  registerGitHandler('git:init', (dir) => gitService.initRepo(dir));
  registerGitHandler('git:stage', (dir, path) => gitService.stageFile(dir, path));
  registerGitHandler('git:unstage', (dir, path) => gitService.unstageFile(dir, path));
  registerGitHandler('git:stageAll', (dir) => gitService.stageAll(dir));
  registerGitHandler('git:unstageAll', (dir) => gitService.unstageAll(dir));
  registerGitHandler('git:discardFile', (dir, path) => gitService.discardFile(dir, path));
  registerGitHandler('git:discardAll', (dir) => gitService.discardAll(dir));
  registerGitHandler('git:commit', (dir, message) => gitService.commit(dir, message));
  registerGitHandler('git:undoLastCommit', (dir) => gitService.undoLastCommit(dir));
  registerGitHandler('git:amendLastCommit', (dir, message) => gitService.amendLastCommit(dir, message));
  registerGitHandler('git:push', (dir) => gitService.push(dir));
  registerGitHandler('git:pull', (dir) => gitService.pull(dir));
  registerGitHandler('git:fetch', (dir) => gitService.fetch(dir));
  registerGitHandler('git:diff', (dir, path) => gitService.getDiff(dir, path));
  registerGitHandler('git:getBranches', (dir) => gitService.getBranches(dir));
  registerGitHandler('git:createBranch', (dir, name, from) => gitService.createBranch(dir, name, from));
  registerGitHandler('git:checkoutBranch', (dir, name) => gitService.checkoutBranch(dir, name));
  registerGitHandler('git:deleteBranch', (dir, name, force) => gitService.deleteBranch(dir, name, force));
  registerGitHandler('git:renameBranch', (dir, oldName, newName) => gitService.renameBranch(dir, oldName, newName));
  registerGitHandler('git:publishBranch', (dir, name) => gitService.publishBranch(dir, name));
  registerGitHandler('git:mergeBranch', (dir, name) => gitService.mergeBranch(dir, name));
  registerGitHandler('git:getLog', (dir, limit) => gitService.getLog(dir, limit));
  registerGitHandler('git:getFileCommitHistory', (dir, relativePath, limit) => gitService.getFileCommitHistory(dir, relativePath, limit));
  registerGitHandler('git:getRemotes', (dir) => gitService.getRemotes(dir));
  registerGitHandler('git:stashPush', (dir, message) => gitService.stashPush(dir, message));
  registerGitHandler('git:stashPop', (dir, index) => gitService.stashPop(dir, index));
  registerGitHandler('git:stashDrop', (dir, index) => gitService.stashDrop(dir, index));
  registerGitHandler('git:stashList', (dir) => gitService.stashList(dir));
  registerGitHandler('git:getMergeStatus', (dir) => gitService.getMergeStatus(dir));
  registerGitHandler('git:getStagedDiff', (dir) => gitService.getStagedDiff(dir));
  registerGitHandler('git:getWorkingTreeDiff', (dir) => gitService.getWorkingTreeDiff(dir));
  registerGitHandler('git:applyWorkingTreeDiff', (dir, diffText) => gitService.applyWorkingTreeDiff(dir, diffText));
  registerGitHandler('git:getHeatmap', (dir, weeks) => gitService.getCommitHeatmap(dir, weeks));
  registerGitHandler('git:getRepoStats', (dir) => gitService.getRepoStats(dir));
  registerGitHandler('git:getCommitFiles', (dir, hash) => gitService.getCommitFiles(dir, hash));
  registerGitHandler('git:getCommitDiff', (dir, hash, path) => gitService.getCommitFileDiff(dir, hash, path));
  registerGitHandler('git:getFileHotspots', (dir, commitLimit, fileLimit) => gitService.getFileHotspots(dir, commitLimit, fileLimit));
  registerGitHandler('git:getCommitPatch', (dir, hash) => gitService.getCommitPatch(dir, hash));
  registerGitHandler('git:getBranchDiff', (dir, branchA, branchB) => gitService.getBranchDiff(dir, branchA, branchB));
  registerGitHandler('git:getBranchFileDiff', (dir, branchA, branchB, path) => gitService.getBranchFileDiff(dir, branchA, branchB, path));
  registerGitHandler('git:getCommitGraph', (dir, limit, skip) => gitService.getCommitGraph(dir, limit, skip));
  registerGitHandler('git:discoverRepos', (rootDir) => gitService.discoverRepos(rootDir));
  registerGitHandler('git:createWorktree', (dir, branchName) => gitService.createWorktree(dir, branchName));
  registerGitHandler('git:removeWorktree', (dir, worktreePath) => gitService.removeWorktree(dir, worktreePath));


  // Database — sql.js is synchronous, but each handler is `async` to satisfy the contract's Promise-returning channels.
  registerDbHandler('db:getFlags', async (projectId) => databaseService.getEffectiveFeatureFlags(projectId));
  registerDbHandler('db:setFlag', async (name, isEnabled, projectId) => databaseService.setFeatureFlag(name, isEnabled, projectId));
  registerDbHandler('db:clearWorkspaceFlagOverride', async (name, projectId) => databaseService.clearWorkspaceFlagOverride(name, projectId));
  registerDbHandler('db:getSettings', async (profileId) => databaseService.getSettings(profileId));
  registerDbHandler('db:setSetting', async (key, value, profileId) => databaseService.setSetting(key, value, profileId));
  registerDbHandler('db:getExtensions', async (profileId) => databaseService.getExtensions(profileId));
  registerDbHandler('db:setExtensionEnabled', async (id, isEnabled, profileId) => databaseService.setExtensionEnabled(id, isEnabled, profileId));
  registerDbHandler('db:saveExtension', async (ext) => databaseService.saveExtension(ext));
  registerDbHandler('db:deleteExtension', async (id) => databaseService.deleteExtension(id));
  registerDbHandler('db:getWorkspaceExtensionOverrides', async (projectId) => databaseService.getWorkspaceExtensionOverrides(projectId));
  registerDbHandler('db:setWorkspaceExtensionEnabled', async (extensionId, projectId, isEnabled) =>
    databaseService.setWorkspaceExtensionEnabled(extensionId, projectId, isEnabled),
  );
  registerDbHandler('db:clearWorkspaceExtensionOverride', async (extensionId, projectId) =>
    databaseService.clearWorkspaceExtensionOverride(extensionId, projectId),
  );
  registerDbHandler('db:getThemes', async () => databaseService.getThemes());
  registerDbHandler('db:saveTheme', async (theme) => databaseService.saveTheme(theme));
  registerDbHandler('db:getConversations', async (projectId) => databaseService.getConversations(projectId));
  registerDbHandler('db:saveConversation', async (id, projectId, title, messages) =>
    databaseService.saveConversation(id, projectId, title, messages)
  );
  registerDbHandler('db:deleteConversation', async (id) => databaseService.deleteConversation(id));

  // Project rules & AI memory
  registerDbHandler('db:getProjectRules', async (projectId) => databaseService.getProjectRules(projectId));
  registerDbHandler('db:saveProjectRule', async (id, projectId, ruleText) => databaseService.saveProjectRule(id, projectId, ruleText));
  registerDbHandler('db:setProjectRuleActive', async (id, isActive) => databaseService.setProjectRuleActive(id, isActive));
  registerDbHandler('db:deleteProjectRule', async (id) => databaseService.deleteProjectRule(id));
  registerDbHandler('db:getProjectMemories', async (projectId) => databaseService.getProjectMemories(projectId));
  registerDbHandler('db:saveProjectMemory', async (id, projectId, memoryKey, memoryVal) =>
    databaseService.saveProjectMemory(id, projectId, memoryKey, memoryVal),
  );
  registerDbHandler('db:deleteProjectMemory', async (id) => databaseService.deleteProjectMemory(id));

  // Commands & Keybindings
  registerDbHandler('db:getCommands', async () => databaseService.getCommands());
  registerDbHandler('db:getKeybindings', async (platform, profileId) => databaseService.getKeybindings(platform, profileId));
  registerDbHandler('db:setKeybinding', async (commandId, keyCombination, platform, profileId) =>
    databaseService.setKeybinding(commandId, keyCombination, platform, profileId)
  );
  registerDbHandler('db:resetKeybindings', async (platform, profileId) =>
    databaseService.resetKeybindings(platform, profileId)
  );
  registerDbHandler('db:getProfiles', async () => databaseService.getProfiles());
  registerDbHandler('db:createProfile', async (id, name) => databaseService.createProfile(id, name));
  registerDbHandler('db:renameProfile', async (id, name) => databaseService.renameProfile(id, name));
  registerDbHandler('db:deleteProfile', async (id) => databaseService.deleteProfile(id));

  // Extension contributions — read-only snapshots of what activated extensions have registered; executeCommand is the one write-ish op, via CommandRegistry.execute().
  registerExtensionsHandler('extensions:getCommands', async () => commandRegistry.list());
  registerExtensionsHandler('extensions:executeCommand', (id, args) => commandRegistry.execute(id, args));
  registerExtensionsHandler('extensions:getStatusBarItems', async () => statusBarRegistry.list());
  registerExtensionsHandler('extensions:getThemes', async () => themeRegistry.list());
  registerExtensionsHandler('extensions:getWalkthroughs', async () => walkthroughsRegistry.list());
  registerExtensionsHandler('extensions:getLanguageServers', async () => languageServerRegistry.list());
  registerExtensionsHandler('extensions:getDebugAdapters', async () => debugAdapterRegistry.list());
  registerExtensionsHandler('extensions:getLanguageDefinitions', async () => languageDefinitionRegistry.list());

  // Snippets — the composition seam between extension-host's SnippetsRegistry and platform's SnippetsService, which stays ignorant of extension-host/ per the layer import rule.
  registerSnippetsHandler('snippets:getForLanguage', async (languageId) =>
    snippetsService.getSnippetsForLanguage(languageId, snippetsRegistry.listForLanguage(languageId)),
  );
  registerSnippetsHandler('snippets:ensureUserSnippetFile', async (languageId) => snippetsService.ensureUserSnippetFile(languageId));
  registerSnippetsHandler('snippets:listUserSnippetFiles', async () => snippetsService.listUserSnippetFiles());
  registerSnippetsHandler('snippets:getUserSnippetFileContent', async (languageId) => snippetsService.getUserSnippetFileContent(languageId));
  registerSnippetsHandler('snippets:writeUserSnippetFileContent', async (languageId, content) =>
    snippetsService.writeUserSnippetFileContent(languageId, content),
  );

  // Project Indexer
  ipcMain.handle('project:index', async (event, { projectId, workspacePath }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 0;
    return await indexWorkspace(projectId, workspacePath, (statusText) => {
      win.webContents.send('project:index-progress', statusText);
    });
  });
  // Single-file re-index on save — no window/progress-event need, so this
  // one goes through the typed registrar unlike its whole-workspace sibling.
  registerIndexerHandler('project:reindexFile', async (projectId, workspacePath, filePath) =>
    reindexFile(projectId, workspacePath, filePath),
  );

  // Code Map + AI Impact Analysis — reads the graph ImpactAnalysisService builds from the indexer's tables.
  registerCodeMapHandler('codemap:getGraph', async (projectId) => impactAnalysisService.getGraph(projectId));
  registerCodeMapHandler('codemap:getImpact', async (projectId, workspacePath, filePath) =>
    impactAnalysisService.getImpact(projectId, workspacePath, filePath),
  );

  // Extension marketplace — delegates entirely to ExtensionMarketplaceService, which owns the zip/scaffold/network mechanics.
  registerExtensionMarketplaceHandler('extensionMarketplace:scaffoldPublish', (payload) =>
    extensionMarketplaceService.scaffoldAndPublish(payload),
  );
  registerExtensionMarketplaceHandler('extensionMarketplace:downloadInstall', (downloadUrl, extensionId, version) =>
    extensionMarketplaceService.downloadAndInstall(downloadUrl, extensionId, version),
  );

  // Filesystem — fs:openFolder stays inline since it orchestrates the native dialog plus project registration, not a pure filesystem op; the rest delegate to FileSystemService.
  registerFsHandler('fs:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const folderName = path.basename(folderPath);
    const id = 'proj_' + Math.random().toString(36).substring(2, 11);
    databaseService.addProject(id, folderName, folderPath);
    return { id, name: folderName, path: folderPath };
  });
  registerFsHandler('fs:showSaveWorkspaceDialog', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save Workspace As',
      defaultPath: 'workspace.sde-workspace',
      filters: [{ name: 'SDE Code Workspace', extensions: ['sde-workspace'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });
  registerFsHandler('fs:showOpenWorkspaceDialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      properties: ['openFile'],
      filters: [{ name: 'SDE Code Workspace', extensions: ['sde-workspace'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  registerFsHandler('fs:getProjectTrust', async (folderPath) => databaseService.getProjectTrustState(folderPath));
  registerFsHandler('fs:getRecentProjects', async (limit) => {
    // Paths are stored verbatim so the same folder can recur with different casing/slashes; dedupe by normalized path and drop folders no longer on disk.
    const seen = new Set<string>();
    const deduped = databaseService.getProjects().filter((p) => {
      if (!fs.existsSync(p.path)) return false;
      const slashNormalized = p.path.replace(/\\/g, '/').replace(/\/+$/, '');
      const normalized = process.platform === 'win32' ? slashNormalized.toLowerCase() : slashNormalized;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    return deduped.slice(0, limit ?? 10).map((p) => ({ id: p.id, name: p.name, path: p.path, lastOpened: p.last_opened }));
  });
  registerFsHandler('fs:setProjectTrust', async (folderPath, state) => databaseService.setProjectTrustState(folderPath, state));
  registerFsHandler('fs:readDir', (dirPath) => fileSystemService.readDir(dirPath));
  registerFsHandler('fs:readFile', (filePath) => fileSystemService.readFile(filePath));
  registerFsHandler('fs:writeFile', (filePath, content) => fileSystemService.writeFile(filePath, content));
  registerFsHandler('fs:createFile', (filePath) => fileSystemService.createFile(filePath));
  registerFsHandler('fs:createDirectory', (dirPath) => fileSystemService.createDirectory(dirPath));
  registerFsHandler('fs:deleteFile', (filePath) => fileSystemService.deleteFile(filePath));
  registerFsHandler('fs:deletePath', (targetPath) => fileSystemService.deletePath(targetPath));
  registerFsHandler('fs:renamePath', (oldPath, newPath) => fileSystemService.renamePath(oldPath, newPath));
  registerFsHandler('fs:revealInExplorer', async (targetPath) => {
    shell.showItemInFolder(targetPath);
    return true;
  });
  registerFsHandler('fs:saveFileSnapshot', async (workspacePath, filePath, content) =>
    databaseService.saveFileSnapshot(workspacePath, filePath, content),
  );
  registerFsHandler('fs:getFileHistory', async (workspacePath, filePath) => databaseService.getFileHistory(workspacePath, filePath));
  registerFsHandler('fs:getFileSnapshotContent', async (id) => databaseService.getFileSnapshotContent(id));

  // Window Controls
  ipcMain.on('win:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('win:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });

  ipcMain.on('win:toggleDevTools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.webContents.toggleDevTools();
  });

  ipcMain.on('win:setTitleBarOverlay', (event, options: { color?: string; symbolColor?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // setTitleBarOverlay() throws unless the window was created with titleBarStyle:'hidden' + titleBarOverlay, Windows/Linux only.
    if (win && process.platform !== 'darwin') {
      // -1 to account for the window's own border — see host/index.ts's
      // matching initial titleBarOverlay.height comment for why.
      win.setTitleBarOverlay({ height: 37, ...options });
    }
  });

  // Search — delegates to platform/search/searchService.ts, now an injectable instance so platform/ai's agent tools can reuse it too.
  registerSearchHandler('search:inFiles', (rootDir, query, options) => searchService.searchInFiles(rootDir, query, options));
  registerSearchHandler('search:listAllFiles', (rootDir) => searchService.listAllFiles(rootDir));
  registerSearchHandler('search:replaceInFiles', (rootDir, query, replaceText, options, targetFile) =>
    searchService.replaceInFiles(rootDir, query, replaceText, options, targetFile),
  );
  registerSearchHandler('search:workspaceSymbols', (rootDir) => searchService.searchWorkspaceSymbols(rootDir));

  // Ports panel — detection runs continuously in main/services/ports.ts regardless of these handlers, which are just the request/response surface; ports:detected/closed stay push events via setPortsBroadcastWindow.
  registerPortsHandler('ports:list', async () => listPorts());
  registerPortsHandler('ports:addManual', async (port) => { addManualPort(port); });
  registerPortsHandler('ports:remove', (port) => removePort(port));
  registerPortsHandler('ports:setLabel', async (port, label) => { setPortLabel(port, label); });
  registerPortsHandler('ports:startTunnel', (port) => startTunnel(port));
  registerPortsHandler('ports:stopTunnel', (port) => stopTunnel(port));
  registerPortsHandler('ports:openExternal', async (url) => {
    // Restrict to http(s) — shell.openExternal would happily launch other protocol handlers otherwise.
    if (!/^https?:\/\//i.test(url)) return;
    await shell.openExternal(url);
  });

  // Auto-update — updater:status is a push event via setUpdaterBroadcastWindow, same pattern as ports:detected/closed above.
  ipcMain.handle('updater:check', (_event, manual?: boolean) => checkForUpdates(manual));
  ipcMain.on('updater:quitAndInstall', () => quitAndInstall());
}

