import { create } from 'zustand';
import { usePanelLayoutStore } from './panelLayout';

interface CodeMapState {
  /** Absolute file path the Impact Report panel (and the spatial canvas) is currently showing — null when nothing's been targeted yet. */
  impactTargetFilePath: string | null;
  setImpactTarget: (filePath: string) => void;

  /** Set by a "View in Code Map" deep-link; CodeMapPanel pans/highlights the matching node then clears it via clearCanvasFocus. Kept separate from impactTargetFilePath since the caller must set both explicitly. */
  pendingCanvasFocusPath: string | null;
  /** Switches to the Code Map sidebar tab and requests a pan/highlight — the one call site every deep-link (Phase 38/39) should use. */
  focusNodeInCanvas: (filePath: string) => void;
  clearCanvasFocus: () => void;
}

export const useCodeMapStore = create<CodeMapState>((set) => ({
  impactTargetFilePath: null,
  setImpactTarget: (filePath) => set({ impactTargetFilePath: filePath }),

  pendingCanvasFocusPath: null,
  focusNodeInCanvas: (filePath) => {
    usePanelLayoutStore.getState().setSidebarTab('codemap');
    usePanelLayoutStore.getState().toggleLeftSidebar(true);
    set({ impactTargetFilePath: filePath, pendingCanvasFocusPath: filePath });
  },
  clearCanvasFocus: () => set({ pendingCanvasFocusPath: null }),
}));
