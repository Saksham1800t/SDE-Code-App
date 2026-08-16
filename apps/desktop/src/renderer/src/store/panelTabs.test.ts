import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Circle } from 'lucide-react';
import { usePanelTabsStore } from './panelTabs';
import { panelTabRegistry, registerPanelTab, type PanelTabDescriptor } from '../panel/panelTabRegistry';
import { installFakeDesktopApi } from './testUtils/fakeDesktopApi';

const fakeTab = (id: string, order: number): PanelTabDescriptor => ({
  id,
  label: id.toUpperCase(),
  icon: Circle,
  order,
  isDefault: true,
  render: () => null,
});

describe('usePanelTabsStore', () => {
  beforeEach(() => {
    // The registry is a module-level singleton (static config, not store
    // state) — reset it between tests the same way store state itself is reset.
    panelTabRegistry.length = 0;
    registerPanelTab(fakeTab('a', 0));
    registerPanelTab(fakeTab('b', 1));
    registerPanelTab(fakeTab('c', 2));
    usePanelTabsStore.setState(usePanelTabsStore.getInitialState());
    installFakeDesktopApi();
  });

  it('getVisibleOrderedTabIds falls back to registry order when nothing is persisted', () => {
    expect(usePanelTabsStore.getState().getVisibleOrderedTabIds()).toEqual(['a', 'b', 'c']);
  });

  it('toggleTabHidden hides a tab and persists the change', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelTabsStore.getState().toggleTabHidden('b');

    expect(usePanelTabsStore.getState().hiddenIds).toEqual(['b']);
    expect(usePanelTabsStore.getState().getVisibleOrderedTabIds()).toEqual(['a', 'c']);
    expect(setSetting).toHaveBeenCalledWith('ide-panel-tab-hidden', JSON.stringify(['b']));
  });

  it('toggleTabHidden un-hides an already-hidden tab', () => {
    usePanelTabsStore.setState({ hiddenIds: ['b'] });

    usePanelTabsStore.getState().toggleTabHidden('b');

    expect(usePanelTabsStore.getState().hiddenIds).toEqual([]);
  });

  it('toggleTabHidden refuses to hide the last visible tab', () => {
    usePanelTabsStore.setState({ hiddenIds: ['a', 'b'] });

    usePanelTabsStore.getState().toggleTabHidden('c');

    expect(usePanelTabsStore.getState().hiddenIds).toEqual(['a', 'b']);
    expect(usePanelTabsStore.getState().getVisibleOrderedTabIds()).toEqual(['c']);
  });

  it('toggleTabBadge toggles and persists', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelTabsStore.getState().toggleTabBadge('a');
    expect(usePanelTabsStore.getState().hiddenBadgeIds).toEqual(['a']);
    expect(setSetting).toHaveBeenLastCalledWith('ide-panel-tab-badge-hidden', JSON.stringify(['a']));

    usePanelTabsStore.getState().toggleTabBadge('a');
    expect(usePanelTabsStore.getState().hiddenBadgeIds).toEqual([]);
  });

  it('reorderTabs sets the persisted order, which getVisibleOrderedTabIds then honors', () => {
    usePanelTabsStore.getState().reorderTabs(['c', 'a', 'b']);

    expect(usePanelTabsStore.getState().getVisibleOrderedTabIds()).toEqual(['c', 'a', 'b']);
  });

  it('getVisibleOrderedTabIds appends a registry tab not yet present in the saved order', () => {
    usePanelTabsStore.setState({ order: ['c', 'a'] });

    expect(usePanelTabsStore.getState().getVisibleOrderedTabIds()).toEqual(['c', 'a', 'b']);
  });

  it('setShowLabels/setShowIcons persist independently', () => {
    const setSetting = vi.fn(async () => {});
    installFakeDesktopApi({ setSetting: setSetting as any });

    usePanelTabsStore.getState().setShowLabels(false);
    usePanelTabsStore.getState().setShowIcons(false);

    expect(usePanelTabsStore.getState().showLabels).toBe(false);
    expect(usePanelTabsStore.getState().showIcons).toBe(false);
    expect(setSetting).toHaveBeenCalledWith('ide-panel-show-labels', '0');
    expect(setSetting).toHaveBeenCalledWith('ide-panel-show-icons', '0');
  });

  it('initializePanelTabs reads persisted layout from settings', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({
        'ide-panel-tab-order': JSON.stringify(['b', 'a', 'c']),
        'ide-panel-tab-hidden': JSON.stringify(['c']),
        'ide-panel-tab-badge-hidden': JSON.stringify(['a']),
        'ide-panel-show-labels': '0',
        'ide-panel-show-icons': '1',
      })) as any,
    });

    await usePanelTabsStore.getState().initializePanelTabs();

    const state = usePanelTabsStore.getState();
    expect(state.order).toEqual(['b', 'a', 'c']);
    expect(state.hiddenIds).toEqual(['c']);
    expect(state.hiddenBadgeIds).toEqual(['a']);
    expect(state.showLabels).toBe(false);
    expect(state.showIcons).toBe(true);
    expect(state.initialized).toBe(true);
  });

  it('initializePanelTabs tolerates malformed JSON in settings, defaulting to empty', async () => {
    installFakeDesktopApi({
      getSettings: vi.fn(async () => ({ 'ide-panel-tab-order': 'not json' })) as any,
    });

    await usePanelTabsStore.getState().initializePanelTabs();

    expect(usePanelTabsStore.getState().order).toEqual([]);
  });
});
