import React, { useEffect, useState, useRef, useCallback } from 'react';
import './App.css';
import { useWorkspaceStore } from './store/workspace';
import { getCustomThemes, useThemeStore } from './store/theme';
import { usePanelLayoutStore } from './store/panelLayout';
import { useTerminalStore } from './store/terminal';
import { useFeatureFlagsStore } from './store/featureFlags';
import { useGitStore } from './store/git';
import { useCommandsStore, normalizeKeyEvent } from './store/commands';
import { FileTree, OutlinePanel, TimelinePanel, ReferencesPanel } from './components/modules/FileTree/index';
import { EditorArea } from './components/modules/EditorArea/index';
import { BottomPanel } from './components/modules/BottomPanel/BottomPanel';
import { GitPanel } from './components/modules/GitPanel/index';
import { CommandPalette } from './components/modules/CommandPalette/index';
import { StatusBar } from './components/modules/StatusBar/index';
import { ExtensionMarketplace } from './components/modules/ExtensionMarketplace/index';
import { AssistantPanel } from './components/modules/AssistantPanel/index';
import { SearchPanel } from './components/modules/SearchPanel/index';
import { GitHubPanel } from './components/modules/GitHubPanel/index';
import { CodeMapPanel } from './components/modules/CodeMap/CodeMapPanel';
import { SdeLogoMark } from './components/common/SdeLogoMark';
import { QuickOpenDialog } from './components/modules/QuickOpen/index';
import { TabSwitcherOverlay } from './components/modules/TabSwitcher/index';
import { LanguagePickerDialog } from './components/modules/SettingsPanel/LanguagePickerDialog';
import { TaskPickerDialog } from './components/modules/TaskRunner/TaskPickerDialog';
import { ensureTasksLoadedThenAlertIfEmpty } from './store/tasks';
import { useExtensionsStore } from './store/extensions';
import { AlertDialog, ConfirmDialog, PromptDialog, UnsavedChangesDialog, ToastContainer, UpdateBanner } from './components/common';
import { useUpdaterStore } from './store/updater';
import { customAlert } from './store/alerts';
import { DIALOG_MESSAGES } from './utils/dialogMessages';
import { FolderOpen, FolderPlus } from 'lucide-react';
import { useGitHubStore } from './store/github';
import { usePanelTabsStore } from './store/panelTabs';
import { useEditorSettingsStore } from './store/editorSettings';
import { useTerminalSettingsStore } from './store/terminalSettings';
import { useAgentProfilesStore } from './store/agentProfiles';
import { useToolchainStore } from './store/toolchain';
import { initializeOutputCapture } from './store/output';
import { registerBuiltinPanelTabs } from './panel/registerBuiltinPanelTabs';
import { useMonaco } from '@monaco-editor/react';
import { useReferencesStore } from './store/references';
import { useBulkRenameStore } from './store/bulkRename';

// Module scope, not inside the component — the panel tab registry must be populated before BottomPanel's first render.
registerBuiltinPanelTabs();
initializeOutputCapture();

// Skip our keydown interception for these when a plain editable element (not Monaco) is focused, so it isn't silently routed to the background editor's activeEditorInstance instead.
const NATIVE_TEXT_EDITING_COMMANDS = new Set(['edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste']);

function isPlainEditableElementFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const isEditable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  if (!isEditable) return false;
  return !el.closest('.monaco-editor');
}

export const App: React.FC = () => {
  const monaco = useMonaco();
  const {
    workspacePath,
    workspaceName,
    setWorkspace,
    refreshFileTree,
    collapseAllFolders,
    startCreatingNode,
    isQuickOpenOpen,
    setQuickOpenOpen,
    openTabs,
    activeTabPath,
  } = useWorkspaceStore();
  const {
    activeSidebarTab,
    setSidebarTab,
    isLeftSidebarOpen,
    isRightSidebarOpen,
    leftSidebarWidth,
    rightSidebarWidth,
    terminalHeight,
    toggleLeftSidebar,
    toggleRightSidebar,
    setLeftSidebarWidth,
    setRightSidebarWidth,
    setTerminalHeight,
    initializePanelLayout,
    isPanelMaximized,
    isZenMode,
  } = usePanelLayoutStore();
  const { initializeTheme, currentTheme, setTheme, localThemes, extensionThemes } = useThemeStore();
  const { loadFeatureFlags, isFlagEnabled } = useFeatureFlagsStore();
  const { isTerminalOpen, toggleTerminalPanel, createNewTerminal, openPanelTab } = useTerminalStore();
  const { initializePanelTabs } = usePanelTabsStore();


  const { extensions } = useExtensionsStore();
  const isGitEnabled = extensions.find((e) => e.id === 'sys.git')?.isEnabled !== false;
  const isAiChatEnabled = extensions.find((e) => e.id === 'sys.aichat')?.isEnabled !== false;
  const isCodeMapEnabled = isFlagEnabled('code-map');

  const customThemes = React.useMemo(() => {
    const themesObj = getCustomThemes();
    return Object.keys(themesObj).map((key) => ({
      name: key,
      label: themesObj[key].label
    }));
  }, [extensions, localThemes, extensionThemes]);

  const {
    initialize: initializeCommands,
    registerCommandCallback,
    executeCommand,
    keybindingsMap,
    keybindings,
    platform
  } = useCommandsStore();

  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isLanguagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [isTaskPickerOpen, setTaskPickerOpen] = useState(false);
  const [quickOpenPrefill, setQuickOpenPrefill] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Resizing refs & logic for Left Sidebar, Right Sidebar (Assistant), and Bottom Terminal
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);
  const isResizingTerminal = useRef(false);

  const handleMouseDownLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeft.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDownRight = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRight.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDownTerminal = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingTerminal.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isResizingLeft.current) {
      const newWidth = Math.max(150, Math.min(600, e.clientX - 50));
      setLeftSidebarWidth(newWidth);
    }
    if (isResizingRight.current) {
      const newWidth = Math.max(200, Math.min(600, window.innerWidth - e.clientX));
      setRightSidebarWidth(newWidth);
    }
    if (isResizingTerminal.current) {
      const newHeight = Math.max(80, Math.min(600, window.innerHeight - e.clientY - 26));
      setTerminalHeight(newHeight);
    }
  };

  const handleMouseUp = () => {
    isResizingLeft.current = false;
    isResizingRight.current = false;
    isResizingTerminal.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const actionToCommandMap: Record<string, string> = {
    'new-file': 'file.newFile',
    'new-folder': 'file.newFolder',
    'open-folder': 'file.openFolder',
    'open-workspace': 'workspace.open',
    'save-workspace-as': 'workspace.saveAs',
    'save-file': 'file.saveFile',
    'close-file': 'file.closeFile',
    'close-folder': 'file.closeFolder',
    'exit': 'file.exit',
    'undo': 'edit.undo',
    'redo': 'edit.redo',
    'cut': 'edit.cut',
    'copy': 'edit.copy',
    'paste': 'edit.paste',
    'format-document': 'edit.formatDocument',
    'toggle-comment': 'edit.toggleComment',
    'go-to-line': 'edit.goToLine',
    'toggle-word-wrap': 'edit.toggleWordWrap',
    'view-explorer': 'view.explorer',
    'view-search': 'view.search',
    'view-git': 'view.git',
    'view-settings': 'view.settings',
    'new-terminal': 'terminal.new',
    'toggle-terminal': 'terminal.toggle',
    'minimize': 'window.minimize',
    'maximize': 'window.maximize',
    'reload': 'window.reload',
    'devtools': 'help.devtools',
    'about': 'help.about'
  };


  useEffect(() => {
    initializeTheme();
    loadFeatureFlags();
    initializeCommands();
    initializePanelTabs();
    initializePanelLayout();
    useEditorSettingsStore.getState().initializeEditorSettings();
    useTerminalSettingsStore.getState().initializeTerminalSettings();
    useAgentProfilesStore.getState().initialize();
    useToolchainStore.getState().loadToolchain();
    useGitHubStore.getState().initialize();
    useUpdaterStore.getState().initialize();
  }, [initializeTheme, loadFeatureFlags, initializeCommands, initializePanelTabs, initializePanelLayout]);

  useEffect(() => {
    if (!isGitEnabled && activeSidebarTab === 'git') {
      setSidebarTab('explorer');
    }
  }, [isGitEnabled, activeSidebarTab, setSidebarTab]);

  useEffect(() => {
    if (!isAiChatEnabled && isRightSidebarOpen) {
      toggleRightSidebar(false);
    }
  }, [isAiChatEnabled, isRightSidebarOpen, toggleRightSidebar]);

  useEffect(() => {
    if (!isCodeMapEnabled && activeSidebarTab === 'codemap') {
      setSidebarTab('explorer');
    }
  }, [isCodeMapEnabled, activeSidebarTab, setSidebarTab]);

  useEffect(() => {
    const handleFocus = () => {
      const active = document.activeElement as HTMLElement;
      if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.closest('.monaco-editor') ||
        active.closest('.xterm-helper-textarea')
      )) {
        lastFocusedRef.current = active;
      }
    };
    document.addEventListener('focusin', handleFocus);
    return () => document.removeEventListener('focusin', handleFocus);
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleOpenFolder = async () => {
    const api = window.api;
    if (api && api.openFolder) {
      const proj = await api.openFolder();
      if (proj) {
        setWorkspace(proj.name, proj.path);
      }
    }
  };

  const handleAddFolderToWorkspace = async () => {
    const api = window.api;
    if (api && api.openFolder) {
      const proj = await api.openFolder();
      if (proj) {
        useWorkspaceStore.getState().addFolderToWorkspace(proj.path, proj.name);
      }
    }
  };

  // Register command handlers on startup
  useEffect(() => {
    const unregisters = [
      registerCommandCallback('file.newFile', () => {
        if (!workspacePath) {
          customAlert(DIALOG_MESSAGES.workspace.openFolderFirst);
          return;
        }
        startCreatingNode('file');
      }),
      registerCommandCallback('file.newFolder', () => {
        if (!workspacePath) {
          customAlert(DIALOG_MESSAGES.workspace.openFolderFirst);
          return;
        }
        startCreatingNode('folder');
      }),
      registerCommandCallback('file.openFolder', () => {
        handleOpenFolder();
      }),
      registerCommandCallback('workspace.saveAs', () => {
        useWorkspaceStore.getState().saveWorkspaceAs();
      }),
      registerCommandCallback('workspace.open', () => {
        useWorkspaceStore.getState().openWorkspaceFile();
      }),
      registerCommandCallback('workspace.trustFolder', () => {
        useWorkspaceStore.getState().trustCurrentWorkspace();
      }),
      registerCommandCallback('file.saveFile', () => {
        const { saveActiveTab } = useWorkspaceStore.getState();
        saveActiveTab();
      }),
      registerCommandCallback('file.closeFile', () => {
        const { activeTabPath, closeFile } = useWorkspaceStore.getState();
        if (activeTabPath) closeFile(activeTabPath);
      }),
      registerCommandCallback('file.closeFolder', () => {
        useWorkspaceStore.setState({
          workspacePath: null,
          workspaceName: null,
          fileTree: [],
          openTabs: [],
          activeTabPath: null
        });
        useGitStore.getState().resetGitStatus();
      }),
      registerCommandCallback('file.exit', () => {
        window.close();
      }),
      registerCommandCallback('edit.undo', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'undo', null);
        } else {
          document.execCommand('undo');
        }
      }),
      registerCommandCallback('edit.redo', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'redo', null);
        } else {
          document.execCommand('redo');
        }
      }),
      registerCommandCallback('edit.cut', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.clipboardCutAction', null);
        } else {
          document.execCommand('cut');
        }
      }),
      registerCommandCallback('edit.copy', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.clipboardCopyAction', null);
        } else {
          document.execCommand('copy');
        }
      }),
      registerCommandCallback('edit.paste', () => {
        // Monaco's own paste action and document.execCommand('paste') both fail in this standalone setup, so we read the OS clipboard via the main process instead.
        const api = window.api;
        if (!api?.readClipboardText) return;
        api.readClipboardText().then((text: string) => {
          if (!text) return;
          const { activeEditorInstance } = useWorkspaceStore.getState();
          if (activeEditorInstance) {
            activeEditorInstance.focus();
            activeEditorInstance.trigger('keyboard', 'type', { text });
          } else {
            document.execCommand('insertText', false, text);
          }
        }).catch((err: unknown) => console.error('Paste failed:', err));
      }),
      registerCommandCallback('view.toggleZenMode', () => {
        usePanelLayoutStore.getState().toggleZenMode();
      }),
      registerCommandCallback('view.splitEditorRight', () => {
        useWorkspaceStore.getState().splitEditorGroup();
      }),
      registerCommandCallback('view.closeEditorGroup', () => {
        const { activeGroupId, closeEditorGroup } = useWorkspaceStore.getState();
        closeEditorGroup(activeGroupId);
      }),
      registerCommandCallback('view.explorer', () => {
        setSidebarTab('explorer');
      }),
      registerCommandCallback('view.git', () => {
        if (isGitEnabled) {
          setSidebarTab('git');
        } else {
          customAlert(DIALOG_MESSAGES.extensions.gitIntegrationDisabled);
        }
      }),
      registerCommandCallback('view.settings', () => {
        useWorkspaceStore.getState().openSettingsTab('settings');
      }),
      registerCommandCallback('view.keyboardShortcuts', () => {
        useWorkspaceStore.getState().openSettingsTab('shortcuts');
      }),
      registerCommandCallback('tasks.runTask', () => {
        ensureTasksLoadedThenAlertIfEmpty(() => setTaskPickerOpen(true));
      }),
      // VS Code keeps snippet configuration out of the Settings UI entirely (Command Palette / File menu only) — matched here.
      registerCommandCallback('edit.configureUserSnippets', () => {
        setLanguagePickerOpen(true);
      }),
      registerCommandCallback('view.repoOverview', () => {
        useWorkspaceStore.getState().openRepoOverviewTab();
      }),
      registerCommandCallback('view.codeHotspots', () => {
        useWorkspaceStore.getState().openCodeHotspotsTab();
      }),
      registerCommandCallback('view.branchComparison', () => {
        useWorkspaceStore.getState().openBranchComparisonTab();
      }),
      registerCommandCallback('view.gitGraph', () => {
        useWorkspaceStore.getState().openGitGraphTab();
      }),
      registerCommandCallback('markdown.openPreview', () => {
        const { activeTabPath, openMarkdownPreview } = useWorkspaceStore.getState();
        if (activeTabPath && /\.mdx?$/i.test(activeTabPath)) {
          openMarkdownPreview(activeTabPath);
        }
      }),
      registerCommandCallback('terminal.new', () => {
        createNewTerminal();
      }),
      registerCommandCallback('terminal.toggle', () => {
        toggleTerminalPanel();
      }),
      registerCommandCallback('window.minimize', () => {
        const api = window.api;
        if (api && api.minimizeWindow) api.minimizeWindow();
      }),
      registerCommandCallback('window.maximize', () => {
        const api = window.api;
        if (api && api.maximizeWindow) api.maximizeWindow();
      }),
      registerCommandCallback('window.reload', () => {
        window.location.reload();
      }),
      registerCommandCallback('help.about', () => {
        customAlert(DIALOG_MESSAGES.help.about);
      }),
      registerCommandCallback('help.devtools', () => {
        const api = window.api;
        if (api && api.toggleDevTools) api.toggleDevTools();
      }),
      registerCommandCallback('project.rebuildIndex', () => {
        const { indexWorkspace } = useWorkspaceStore.getState();
        indexWorkspace();
      }),
      registerCommandCallback('edit.formatDocument', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.formatDocument', null);
        }
      }),
      registerCommandCallback('edit.toggleComment', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.commentLine', null);
        }
      }),
      registerCommandCallback('edit.goToLine', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.gotoLine', null);
        }
      }),
      registerCommandCallback('edit.toggleWordWrap', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.toggleWordWrap', null);
        }
      }),
      // These five depend on a real language-service provider being registered for the active file's language (see monacoSetup.ts).
      registerCommandCallback('edit.goToDefinition', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.revealDefinition', null);
        }
      }),
      registerCommandCallback('edit.peekDefinition', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.peekDefinition', null);
        }
      }),
      registerCommandCallback('edit.findAllReferences', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.goToReferences', null);
          // Also populate the persistent References sidebar panel alongside Monaco's own transient peek widget.
          if (monaco) useReferencesStore.getState().findReferences(monaco, activeEditorInstance);
        }
      }),
      registerCommandCallback('edit.renameSymbol', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.rename', null);
        }
      }),
      registerCommandCallback('edit.renameSymbolPreview', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance && monaco) {
          useBulkRenameStore.getState().startRename(monaco, activeEditorInstance);
        }
      }),
      registerCommandCallback('edit.formatDocument', () => {
        const { activeEditorInstance } = useWorkspaceStore.getState();
        if (activeEditorInstance) {
          activeEditorInstance.focus();
          activeEditorInstance.trigger('menu', 'editor.action.formatDocument', null);
        }
      }),
      registerCommandCallback('view.search', () => {
        setSidebarTab('search' as any);
        toggleLeftSidebar(true);
      }),
      // Was previously inert — the status bar's "problems" item already had
      // this commandId (store/statusBar.ts) but nothing handled it.
      registerCommandCallback('workbench.action.showErrors', () => {
        openPanelTab('problems');
      }),
    ];

    return () => {
      unregisters.forEach(unreg => unreg());
    };
  }, [registerCommandCallback, workspacePath, startCreatingNode, createNewTerminal, toggleTerminalPanel, setSidebarTab, isGitEnabled, monaco]);

  // Command-driven keyboard listener (capture phase)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const normalized = normalizeKeyEvent(e, platform);
      const commandId = keybindingsMap[normalized];

      if (commandId) {
        if (NATIVE_TEXT_EDITING_COMMANDS.has(commandId) && isPlainEditableElementFocused()) {
          return; // let the focused field's own native undo/redo/cut/copy/paste run
        }
        e.preventDefault();
        e.stopPropagation();
        executeCommand(commandId);
      } else {
        // Fallback for opening command palette
        if (normalized === 'Ctrl+Shift+P' || normalized === 'Cmd+Shift+P') {
          e.preventDefault();
          e.stopPropagation();
          const isCommandCenterEnabled = useExtensionsStore.getState().extensions.find(x => x.id === 'sys.commandcenter')?.isEnabled !== false;
          if (isCommandCenterEnabled) {
            executeCommand('workbench.action.showCommands');
          } else {
            customAlert(DIALOG_MESSAGES.extensions.commandCenterDisabled);
          }
        }
        // Quick Open: Ctrl+P / Cmd+P
        if (normalized === 'Ctrl+P' || normalized === 'Cmd+P') {
          e.preventDefault();
          e.stopPropagation();
          setQuickOpenPrefill('');
          setQuickOpenOpen(true);
        }
        // Go to Line: Ctrl+G / Cmd+G — reuses Quick Open, pre-filled into its ':line' mode.
        if (normalized === 'Ctrl+G' || normalized === 'Cmd+G') {
          e.preventDefault();
          e.stopPropagation();
          setQuickOpenPrefill(':');
          setQuickOpenOpen(true);
        }
        // Go to Symbol in File: Ctrl+Shift+O / Cmd+Shift+O — reuses Quick Open's '@symbol' mode.
        if (normalized === 'Ctrl+Shift+O' || normalized === 'Cmd+Shift+O') {
          e.preventDefault();
          e.stopPropagation();
          setQuickOpenPrefill('@');
          setQuickOpenOpen(true);
        }
        // Go to Symbol in Workspace: Ctrl+T / Cmd+T — reuses Quick Open's '#symbol' mode.
        if (normalized === 'Ctrl+T' || normalized === 'Cmd+T') {
          e.preventDefault();
          e.stopPropagation();
          setQuickOpenPrefill('#');
          setQuickOpenOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [keybindingsMap, platform, executeCommand, setQuickOpenOpen]);

  const handleMenuAction = useCallback((action: string) => {
    setActiveMenu(null);
    const commandId = actionToCommandMap[action];
    if (commandId) {
      executeCommand(commandId);
    }
  }, [executeCommand]);

  const getMenuShortcutText = useCallback((action: string) => {
    const commandId = actionToCommandMap[action];
    if (!commandId) return '';
    const kb = keybindings.find((k) => k.command_id === commandId);
    return kb ? kb.key_combination : '';
  }, [keybindings]);

  const menus: Record<string, Array<{ label?: string; action?: string; type?: 'separator' }>> = {
    File: [
      { label: 'New File', action: 'new-file' },
      { label: 'New Folder', action: 'new-folder' },
      { type: 'separator' },
      { label: 'Open Folder...', action: 'open-folder' },
      { label: 'Open Workspace...', action: 'open-workspace' },
      { label: 'Save Workspace As...', action: 'save-workspace-as' },
      { label: 'Save File', action: 'save-file' },
      { label: 'Close Active Tab', action: 'close-file' },
      { label: 'Close Folder', action: 'close-folder' },
      { type: 'separator' },
      { label: 'Exit', action: 'exit' }
    ],
    Edit: [
      { label: 'Undo', action: 'undo' },
      { label: 'Redo', action: 'redo' },
      { type: 'separator' },
      { label: 'Cut', action: 'cut' },
      { label: 'Copy', action: 'copy' },
      { label: 'Paste', action: 'paste' },
      { type: 'separator' },
      { label: 'Format Document', action: 'format-document' },
      { label: 'Toggle Line Comment', action: 'toggle-comment' },
      { label: 'Toggle Word Wrap', action: 'toggle-word-wrap' },
      { type: 'separator' },
      { label: 'Go to Line...', action: 'go-to-line' },
    ],
    View: [
      { label: 'Explorer', action: 'view-explorer' },
      { label: 'Search', action: 'view-search' },
      { label: 'Source Control', action: 'view-git' },
      { label: 'Settings', action: 'view-settings' },
    ],

    Terminal: [
      { label: 'New Terminal', action: 'new-terminal' },
      { label: 'Toggle Terminal', action: 'toggle-terminal' }
    ],
    Window: [
      { label: 'Minimize', action: 'minimize' },
      { label: 'Maximize', action: 'maximize' },
      { label: 'Reload Window', action: 'reload' }
    ],
    Help: [
      { label: 'About SDE Code', action: 'about' },
      { label: 'Toggle Developer Tools', action: 'devtools' }
    ]
  };

  return (
    <div className="sde-app-container">
      {/* Top Application Bar */}
      <div className="sde-titlebar">
        {/* Leftmost Brand & Menus */}
        <div className="sde-brand">
          {/* Logo & Name */}
          <div className="sde-logo">
            <SdeLogoMark size={18} />
            <span className="sde-logo-text">SDE CODE</span>
          </div>

          {/* Menus List */}
          <div ref={menuRef} className="sde-menubar">
            {Object.keys(menus).map((menuName) => (
              <div key={menuName} className="sde-menu-container">
                <button
                  onClick={() => setActiveMenu(activeMenu === menuName ? null : menuName)}
                  onMouseEnter={() => { if (activeMenu) setActiveMenu(menuName); }}
                  className={`sde-menu-btn${activeMenu === menuName ? ' active' : ''}`}
                >
                  {menuName}
                </button>

                {activeMenu === menuName && (
                  <div className="sde-dropdown-menu">
                    {menus[menuName].map((item, index) => {
                      if (item.type === 'separator') {
                        return (
                          <div key={index} className="sde-dropdown-separator" />
                        );
                      }
                      const shortcut = getMenuShortcutText(item.action!);
                      return (
                        <button
                          key={item.label}
                          onClick={() => handleMenuAction(item.action!)}
                          className="sde-dropdown-item"
                        >
                          <span>{item.label}</span>
                          {shortcut && (
                            <span className="sde-dropdown-shortcut">{shortcut}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Active Workspace / Project Title */}
        <div className="sde-workspace-title">
          {workspaceName ? <><FolderOpen size={12} /> {workspaceName}</> : 'No Project Active'}
        </div>

        {/* Global Controls */}
        <div className="sde-global-controls">
          {/* Custom Layout Panel Controls */}
          <div className="sde-layout-controls">
            {/* Reset Layout */}
            <button
              onClick={() => {
                toggleLeftSidebar(true);
                toggleRightSidebar(true);
                toggleTerminalPanel(true);
                setLeftSidebarWidth(260);
                setRightSidebarWidth(320);
                setTerminalHeight(240);
              }}
              title="Reset Panel Layouts"
              className="sde-layout-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="9" y1="12" x2="21" y2="12"></line>
              </svg>
            </button>

            {/* Toggle Left Sidebar */}
            <button
              onClick={() => toggleLeftSidebar()}
              title="Toggle Left Sidebar"
              className={`sde-layout-btn${isLeftSidebarOpen ? ' sde-layout-btn--active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
            </button>

            {/* Toggle Bottom Terminal */}
            <button
              onClick={() => toggleTerminalPanel()}
              title="Toggle Terminal Panel"
              className={`sde-layout-btn${isTerminalOpen ? ' sde-layout-btn--active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="15" x2="21" y2="15"></line>
              </svg>
            </button>

            {/* Toggle Right Sidebar / AI Assistant */}
            <button
              onClick={() => toggleRightSidebar()}
              title="Toggle Right Sidebar (AI Assistant)"
              className={`sde-layout-btn${isRightSidebarOpen ? ' sde-layout-btn--active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
          </div>

          <select
            value={currentTheme}
            onChange={(e) => setTheme(e.target.value)}
            className="sde-theme-select"
          >
            {customThemes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Grid Workspace Layout */}
      <div className="sde-main-workspace">

        {/* Leftmost Navigation Strip — hidden in Zen Mode */}
        {!isZenMode && (
        <div className="sde-activitybar">
          {[
            {
              id: 'explorer',
              label: 'Explorer',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              ),
            },
            {
              id: 'search',
              label: 'Search (Ctrl+Shift+F)',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              ),
            },
            isGitEnabled && {
              id: 'git',
              label: 'Git Control',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="18" r="3"></circle>
                  <circle cx="6" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <path d="M18 15V9a4 4 0 0 0-4-4H9"></path>
                  <line x1="6" y1="9" x2="6" y2="15"></line>
                </svg>
              ),
            },
            isAiChatEnabled && {
              id: 'assistant',
              label: 'AI Assistant',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                  <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5 5 3Z" opacity="0.6" />
                  <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" opacity="0.6" />
                </svg>
              ),
            },
            {
              id: 'extensions',
              label: 'Extensions',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
              ),
            },
            isCodeMapEnabled && {
              id: 'codemap',
              label: 'Code Map',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="6" r="2.5"></circle>
                  <circle cx="19" cy="6" r="2.5"></circle>
                  <circle cx="12" cy="18" r="2.5"></circle>
                  <path d="M7.2 7.2 10 15.8M16.8 7.2 14 15.8M7.5 6h9"></path>
                </svg>
              ),
            },
            {
              id: 'github',
              label: 'GitHub',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.535-1.53.115-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.65 1.65.235 2.88.115 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              ),
            },
            {
              id: 'settings',
              label: 'Settings',
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              ),
            },
          ].filter(Boolean).map((tab: any) => {
            // Settings has no persistent sidebar view, so its "active" state tracks the open editor tab instead of activeSidebarTab.
            const isActive = tab.id === 'assistant'
              ? isRightSidebarOpen
              : tab.id === 'settings'
              ? openTabs.find((t) => t.path === activeTabPath)?.settingsType === 'settings'
              : (activeSidebarTab === tab.id && isLeftSidebarOpen);
            return (
              <div
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'assistant') {
                    toggleRightSidebar();
                  } else if (tab.id === 'settings') {
                    useWorkspaceStore.getState().openSettingsTab('settings');
                  } else {
                    setSidebarTab(tab.id as any);
                    toggleLeftSidebar(true);
                  }
                }}
                title={tab.label}
                className={`sde-activity-btn${isActive ? ' active' : ''}`}
              >
                {tab.icon}
              </div>
            );
          })}
        </div>
        )}

        {/* Active Side Panel drawer */}
        {isLeftSidebarOpen && (
          <div className="sde-sidebar-left" style={{ width: `${leftSidebarWidth}px` }}>
            {activeSidebarTab === 'explorer' && (
              <>
                <div className="sde-sidebar-header">
                  <span>EXPLORER</span>
                  {workspacePath && (
                    <div className="sde-sidebar-actions">
                      {/* Add Folder to Workspace */}
                      <button
                        onClick={handleAddFolderToWorkspace}
                        data-tooltip="Add Folder to Workspace..."
                        className="sde-sidebar-action-btn"
                      >
                        <FolderPlus size={14} />
                      </button>

                      {/* New File */}
                      <button
                        onClick={() => startCreatingNode('file')}
                        data-tooltip="New File (Ctrl+N)"
                        className="sde-sidebar-action-btn"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"></path>
                          <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                          <path d="M18 12v6"></path>
                          <path d="M15 15h6"></path>
                        </svg>
                      </button>

                      {/* New Folder */}
                      <button
                        onClick={() => startCreatingNode('folder')}
                        data-tooltip="New Folder (Ctrl+Shift+N)"
                        className="sde-sidebar-action-btn"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 10v-3a2 2 0 0 0-2-2H9l-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"></path>
                          <path d="M18 14v6"></path>
                          <path d="M15 17h6"></path>
                        </svg>
                      </button>

                      {/* Refresh Explorer */}
                      <button
                        onClick={() => refreshFileTree()}
                        data-tooltip="Refresh Explorer"
                        className="sde-sidebar-action-btn"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.5 2v6h-6"></path>
                          <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                        </svg>
                      </button>

                      {/* Collapse All Folders */}
                      <button
                        onClick={() => collapseAllFolders()}
                        data-tooltip="Collapse Folders"
                        className="sde-sidebar-action-btn"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 14V4a2 2 0 0 1 2-2h10"></path>
                          <rect x="8" y="8" width="12" height="12" rx="2"></rect>
                          <line x1="11" y1="14" x2="17" y2="14"></line>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <FileTree />
                <OutlinePanel />
                <TimelinePanel />
                <ReferencesPanel />
              </>
            )}

            {activeSidebarTab === 'git' && (
              <>
                <div className="sde-sidebar-header">
                  SOURCE CONTROL
                </div>
                <GitPanel />
              </>
            )}

            {activeSidebarTab === 'extensions' && <ExtensionMarketplace />}

            {activeSidebarTab === 'codemap' && (
              <>
                <div className="sde-sidebar-header">
                  CODE MAP
                </div>
                <CodeMapPanel />
              </>
            )}

            {activeSidebarTab === 'search' && <SearchPanel />}

            {activeSidebarTab === 'github' && (
              <>
                <div className="sde-sidebar-header">
                  GITHUB
                </div>
                <GitHubPanel />
              </>
            )}
          </div>
        )}

        {/* Left Resize Handle */}
        {isLeftSidebarOpen && (
          <div
            onMouseDown={handleMouseDownLeft}
            className="sde-resizer-v"
          />
        )}

        {/* Center Panel (Monaco Editor & Terminal splits) */}
        <div className="sde-center-panel">
          {/* "Maximized panel" means the editor is hidden entirely, matching VS Code's own isPanelMaximized() semantics. */}
          {!isPanelMaximized && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <EditorArea />
            </div>
          )}

          {/* Terminal Panel */}
          {isTerminalOpen && (
            <>
              {/* Hidden while maximized — dragging is meaningless once there's no editor to trade space with. */}
              {!isPanelMaximized && (
                <div
                  onMouseDown={handleMouseDownTerminal}
                  className="sde-resizer-h"
                />
              )}
              <div style={isPanelMaximized ? { flex: 1, overflow: 'hidden' } : { height: `${terminalHeight}px`, overflow: 'hidden' }}>
                <BottomPanel />
              </div>
            </>
          )}
        </div>

        {/* Right Resize Handle */}
        {isRightSidebarOpen && (
          <div
            onMouseDown={handleMouseDownRight}
            className="sde-resizer-v"
          />
        )}

        {/* Right Side AI Assistant Drawer */}
        {isRightSidebarOpen && (
          <div className="sde-sidebar-right" style={{ width: `${rightSidebarWidth}px` }}>
            <AssistantPanel />
          </div>
        )}

      </div>

      {/* Status Bar — hidden in Zen Mode */}
      {!isZenMode && <StatusBar />}

      {/* Global Command Palette Component Overlay */}
      <CommandPalette />

      {/* Quick Open (Ctrl+P) / Go to Line (Ctrl+G) */}
      {isQuickOpenOpen && <QuickOpenDialog initialQuery={quickOpenPrefill} onClose={() => setQuickOpenOpen(false)} />}

      {/* Tab Switcher (Ctrl+Tab) — always mounted; manages its own visibility internally */}
      <TabSwitcherOverlay />

      {/* Configure Snippets (Command Palette / File menu only — matches
          VS Code, which keeps this out of the Settings UI entirely) */}
      {isLanguagePickerOpen && (
        <LanguagePickerDialog onClose={() => setLanguagePickerOpen(false)} onLanguageConfigured={() => {}} />
      )}

      {/* Run Task (Command Palette / Terminal panel "Run Task..." button) */}
      {isTaskPickerOpen && <TaskPickerDialog onClose={() => setTaskPickerOpen(false)} />}

      {/* Global Custom Alert Dialog */}
      <AlertDialog />
      <ConfirmDialog />
      <PromptDialog />
      <UnsavedChangesDialog />
      <ToastContainer />
      <UpdateBanner />
    </div>
  );
};

export default App;
