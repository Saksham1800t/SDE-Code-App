import type * as SdeSdk from '@sde-code/sdk';
import { RpcExtensionSide } from '../protocol';
import { SandboxRequire } from './vmSandbox';

/** What `require('@sde-code/sdk')` resolves to inside an extension's sandbox — a host-constructed object, typed against the real package so drift fails to compile rather than silently diverging. */
export function createSdkBridge(extensionSide: RpcExtensionSide): typeof SdeSdk {
  return {
    registerCommand(id, callback) {
      const callbackId = extensionSide.registerCallback(callback);
      extensionSide.register('command', { id, callbackId });
    },

    registerStatusBarItem(id, options) {
      extensionSide.register('statusBarItem', { id, options });
    },

    registerTheme(id, variables) {
      extensionSide.register('theme', { id, variables });
    },

    registerAIProvider(provider) {
      // No host-side registry consumes 'aiProvider' yet; note the raw AbortSignal arg only works because v1 is same-process — a real transport will need a serializable "cancel" message instead.
      const callbackId = extensionSide.registerStreamingCallback(async (onChunk, request, signal) => {
        await provider.streamCompletion(
          request as SdeSdk.AIProviderRequest,
          (chunk) => onChunk(chunk),
          signal as AbortSignal,
        );
      });
      extensionSide.register('aiProvider', {
        id: provider.id,
        displayName: provider.displayName,
        models: provider.models,
        callbackId,
      });
    },

    registerAITool(tool) {
      const callbackId = extensionSide.registerCallback((args) => tool.execute(args as Record<string, unknown>));
      extensionSide.register('aiTool', {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        callbackId,
      });
    },

    registerContextProvider(provider) {
      const callbackId = extensionSide.registerCallback((request) =>
        provider.provideContext(request as { activeFilePath?: string; prompt: string }),
      );
      extensionSide.register('contextProvider', { id: provider.id, callbackId });
    },
  };
}

/** The sandboxed `require` an extension sees: resolves `@sde-code/sdk` to a bridge bound to its own RpcExtensionSide, denies everything else (no fs/child_process/npm access in v1). */
export function createSandboxRequire(extensionSide: RpcExtensionSide): SandboxRequire {
  const bridge = createSdkBridge(extensionSide);
  return (specifier: string): unknown => {
    if (specifier === '@sde-code/sdk') return bridge;
    throw new Error(`Module "${specifier}" is not available inside an SDE Code extension sandbox.`);
  };
}
