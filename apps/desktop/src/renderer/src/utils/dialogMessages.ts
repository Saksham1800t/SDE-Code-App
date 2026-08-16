/** Every alert/confirm dialog's copy, in one place. Static strings are plain values; messages needing runtime data are functions. */
export const DIALOG_MESSAGES = {
  workspace: {
    openFolderFirst: 'Please open a folder first.',
    errorCreatingItem: (err: unknown) => `Error creating item: ${err}`,
    confirmDeleteFile: (name: string) => `Delete "${name}"? This cannot be undone.`,
    confirmDeleteFolder: (name: string) => `Delete "${name}" and everything inside it? This cannot be undone.`,
    errorDeletingItem: (err: unknown) => `Error deleting item: ${err}`,
    errorRenamingItem: (err: unknown) => `Error renaming item: ${err}`,
  },
  snippets: {
    openFileFirstForLanguage: 'Open a file first to configure snippets for its language.',
    failedToOpenSnippetsFile: 'Failed to open the snippets file.',
  },
  extensions: {
    gitIntegrationDisabled: 'Git Integration extension is currently disabled.',
    commandCenterDisabled: 'Command Center extension is currently disabled.',
    toggleFailed: (message?: string) => message || 'Action failed.',
    downloadingPackage: (name: string) => `Downloading ${name} package bundle...`,
    installerBridgeMissing: 'Extension installer API bridges are missing.',
    installSuccess: (name: string) => `Successfully installed: ${name}!`,
    installFailed: (err: any) => err?.message || 'Failed to install extension.',
    uninstallFailed: (message?: string) => message || 'Uninstall failed.',
    uninstallSuccess: 'Extension uninstalled successfully.',
  },
  help: {
    about: 'SDE Code IDE v1.0.0\nProfessional Desktop Developer Workspace.',
  },
  keybindings: {
    migrationComplete: (count: number) => `Keymap migration complete! Imported ${count} matching keybindings successfully.`,
    invalidProfileFormat: 'Invalid profile format. Expected JSON array of keybindings.',
    failedToParseKeymapFile: 'Failed to parse keymap configuration file.',
    confirmDeleteProfile: (name: string) => `Delete the keybinding profile "${name}"? This removes every custom shortcut in it — this can't be undone.`,
    failedToCreateProfile: 'Failed to create keybinding profile. A profile with that name may already exist.',
  },
  tasks: {
    noTasksConfigured: 'No tasks configured. Create a .sde/tasks.json in your workspace root to define some.',
  },
  git: {
    confirmDiscardAllUnstaged: 'Discard ALL unstaged changes? This cannot be undone.',
    confirmDiscardFile: (relativePath: string) => `Discard changes to ${relativePath}?`,
  },
  editor: {
    failedToStage: (err: any) => `Failed to stage: ${err?.message || err}`,
    failedToDiscard: (err: any) => `Failed to discard: ${err?.message || err}`,
    confirmDiscardFileChanges: (relativePath: string) => `Discard all changes to ${relativePath}?`,
  },
  account: {
    confirmDeleteAccount:
      "Permanently delete your account? This removes your login and your cloud-synced settings backup (settings, keybindings, snippets). Extensions or themes you've published will not be affected. This cannot be undone.",
  },
  mcp: {
    confirmDeleteServer: (name: string) => `Delete the MCP server "${name}"? Its tools will no longer be available to the AI Assistant.`,
  },
  externalAgent: {
    confirmDeleteConfig: (name: string) => `Delete the external agent "${name}"?`,
  },
} as const;
