export interface Command {
  id: string;
  name: string;
  category: string;
  description: string;
  source: string;
}

export interface Keybinding {
  command_id: string;
  key_combination: string;
  platform: string;
  profile_id: string;
}

export interface Profile {
  id: string;
  name: string;
  created_at: number;
}

export interface CommandsState {
  commands: Command[];
  /** IDs contributed by extensions — execute() routes these to the main process instead of a local callback. */
  extensionCommandIds: Set<string>;
  keybindings: Keybinding[];
  keybindingsMap: Record<string, string>; // key_combination -> command_id
  callbacks: Record<string, (...args: any[]) => void>;
  platform: string;
  isPaletteOpen: boolean;
  /** Most-recently-executed command IDs, most recent first — sorted to the top of the palette. */
  recentCommandIds: string[];
  /** Every keybinding profile that exists — always includes at least 'default'. */
  profiles: Profile[];
  /** Which profile's keybindings `keybindings`/`keybindingsMap` currently reflect, and which updateKeybinding/resetKeybindings target. */
  activeProfileId: string;

  // Actions
  initialize: () => Promise<void>;
  registerCommandCallback: (commandId: string, cb: (...args: any[]) => void) => () => void;
  executeCommand: (commandId: string, ...args: any[]) => void;
  updateKeybinding: (commandId: string, keyCombination: string) => Promise<boolean>;
  resetKeybindings: () => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  /** Switches which profile's keybindings are active and reloads them. */
  setActiveProfileId: (id: string) => Promise<void>;
  /** Creates a profile (seeded with the default keybindings, see databaseService.createProfile) and switches to it. Returns false if the id/name is invalid or already taken. */
  createProfile: (name: string) => Promise<boolean>;
  renameProfile: (id: string, name: string) => Promise<boolean>;
  /** Refuses to delete 'default'. Switches back to 'default' first if the deleted profile was active. */
  deleteProfile: (id: string) => Promise<boolean>;
}
