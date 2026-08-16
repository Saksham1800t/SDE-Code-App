import { ServiceCollection, SyncDescriptor, InstantiationService, ILogService, ConsoleLogService, IGitService, GitService, IFileSystemService, FileSystemService, IDatabaseService, DatabaseService, IAiService, AiService, ISearchService, SearchService, ISnippetsService, SnippetsService, IExtensionMarketplaceService, ExtensionMarketplaceService, IGitHubService, GitHubService, IMcpService, McpService, IImpactAnalysisService, ImpactAnalysisService, ILspService, LspService, IDapService, DapService, IExternalAgentService, ExternalAgentService, INotebookKernelService, NotebookKernelService, type IExtensionToolProvider } from '../platform';
import type { AITool } from '@sde-code/sdk';
import { IExtensionHostService, ExtensionHostService, ICommandRegistry, CommandRegistry, IStatusBarRegistry, StatusBarRegistry, IThemeRegistry, ThemeRegistry, ISnippetsRegistry, SnippetsRegistry, IWalkthroughsRegistry, WalkthroughsRegistry, IAiToolRegistry, AIToolRegistry, IAiContextProviderRegistry, AIContextProviderRegistry, ILanguageServerRegistry, LanguageServerRegistry, IDebugAdapterRegistry, DebugAdapterRegistry, ILanguageDefinitionRegistry, LanguageDefinitionRegistry } from '../extension-host';

/** The composition root: builds the DI container; `main/services/{indexer,terminal}` aren't yet migrated onto DI, so `ipc.ts` still calls them directly. */
const services = new ServiceCollection();
services.set(ILogService, new SyncDescriptor(ConsoleLogService));
services.set(IGitService, new SyncDescriptor(GitService));
services.set(IFileSystemService, new SyncDescriptor(FileSystemService));
services.set(IDatabaseService, new SyncDescriptor(DatabaseService));
services.set(ISearchService, new SyncDescriptor(SearchService));
services.set(IAiService, new SyncDescriptor(AiService));
services.set(IExtensionHostService, new SyncDescriptor(ExtensionHostService));
services.set(ICommandRegistry, new SyncDescriptor(CommandRegistry));
services.set(IStatusBarRegistry, new SyncDescriptor(StatusBarRegistry));
services.set(IThemeRegistry, new SyncDescriptor(ThemeRegistry));
services.set(ISnippetsService, new SyncDescriptor(SnippetsService));
services.set(ISnippetsRegistry, new SyncDescriptor(SnippetsRegistry));
services.set(IWalkthroughsRegistry, new SyncDescriptor(WalkthroughsRegistry));
services.set(IExtensionMarketplaceService, new SyncDescriptor(ExtensionMarketplaceService));
services.set(IGitHubService, new SyncDescriptor(GitHubService));
services.set(IMcpService, new SyncDescriptor(McpService));
services.set(IImpactAnalysisService, new SyncDescriptor(ImpactAnalysisService));
services.set(ILspService, new SyncDescriptor(LspService));
services.set(IDapService, new SyncDescriptor(DapService));
services.set(IExternalAgentService, new SyncDescriptor(ExternalAgentService));
services.set(INotebookKernelService, new SyncDescriptor(NotebookKernelService));
services.set(IAiToolRegistry, new SyncDescriptor(AIToolRegistry));
services.set(IAiContextProviderRegistry, new SyncDescriptor(AIContextProviderRegistry));
services.set(ILanguageServerRegistry, new SyncDescriptor(LanguageServerRegistry));
services.set(IDebugAdapterRegistry, new SyncDescriptor(DebugAdapterRegistry));
services.set(ILanguageDefinitionRegistry, new SyncDescriptor(LanguageDefinitionRegistry));

const instantiationService = new InstantiationService(services);

export const logService = instantiationService.getService(ILogService);
export const gitService = instantiationService.getService(IGitService);
export const fileSystemService = instantiationService.getService(IFileSystemService);
export const searchService = instantiationService.getService(ISearchService);
export const aiService = instantiationService.getService(IAiService);
export const extensionHostService = instantiationService.getService(IExtensionHostService);
export const commandRegistry = instantiationService.getService(ICommandRegistry);
export const statusBarRegistry = instantiationService.getService(IStatusBarRegistry);
export const themeRegistry = instantiationService.getService(IThemeRegistry);
export const snippetsService = instantiationService.getService(ISnippetsService);
export const snippetsRegistry = instantiationService.getService(ISnippetsRegistry);
export const walkthroughsRegistry = instantiationService.getService(IWalkthroughsRegistry);
export const extensionMarketplaceService = instantiationService.getService(IExtensionMarketplaceService);
export const githubService = instantiationService.getService(IGitHubService);
export const mcpService = instantiationService.getService(IMcpService);
export const impactAnalysisService = instantiationService.getService(IImpactAnalysisService);
export const lspService = instantiationService.getService(ILspService);
export const dapService = instantiationService.getService(IDapService);
export const externalAgentService = instantiationService.getService(IExternalAgentService);
export const notebookKernelService = instantiationService.getService(INotebookKernelService);

// Extension-contributed AI tools/context wired into AiService via setter, not constructor DI, so aiService.test.ts's `new AiService(...)` needs no 6th arg.
const aiToolRegistry = instantiationService.getService(IAiToolRegistry);
const aiContextProviderRegistry = instantiationService.getService(IAiContextProviderRegistry);

// Merges extension-contributed tools and MCP-server tools into a single provider so AiService needs no MCP-specific changes.
class CompositeToolProvider implements IExtensionToolProvider {
  constructor(private readonly providers: IExtensionToolProvider[]) {}
  listTools(): AITool[] {
    return this.providers.flatMap((p) => p.listTools());
  }
}
aiService.setExtensionToolProvider(new CompositeToolProvider([aiToolRegistry, mcpService]));
aiService.setExtensionContextProvider(aiContextProviderRegistry);

export const languageServerRegistry = instantiationService.getService(ILanguageServerRegistry);
lspService.setExtensionLanguageServerProvider(languageServerRegistry);

export const debugAdapterRegistry = instantiationService.getService(IDebugAdapterRegistry);
dapService.setExtensionDebugAdapterProvider(debugAdapterRegistry);

export const languageDefinitionRegistry = instantiationService.getService(ILanguageDefinitionRegistry);

/** NOT yet initialized here — index.ts awaits DatabaseService.initialize() at startup; never construct a second DatabaseService or you get two diverging in-memory copies. */
export const databaseService = instantiationService.getService(IDatabaseService);
