import vm from 'vm';

/** What an extension's entry module is expected to export — the same activate/deactivate lifecycle shape VS Code extensions use. */
export interface SandboxedExtensionModule {
  activate?(): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** Resolves a module specifier an extension's `require()`s to a value or throws; deliberately generic — mapping `@sde-code/sdk` is sdkBridge.ts's job, not this file's. */
export type SandboxRequire = (specifier: string) => unknown;

/** Runs the extension's compiled entry file in its own `vm` context for state isolation only — NOT a security boundary, since `vm` shares the host process's memory and a determined script can escape it. */
export function loadExtensionInSandbox(sourceCode: string, filename: string, requireFn: SandboxRequire): SandboxedExtensionModule {
  const context = vm.createContext({ console });

  const wrapped = `(function (module, exports, require, __filename, __dirname) {\n${sourceCode}\n});`;
  const script = new vm.Script(wrapped, { filename });
  const moduleFactory = script.runInContext(context) as (
    moduleObj: { exports: unknown },
    exportsObj: unknown,
    require: SandboxRequire,
    filename: string,
    dirname: string,
  ) => void;

  const moduleObj: { exports: unknown } = { exports: {} };
  const dirname = filename.replace(/[/\\][^/\\]*$/, '');
  moduleFactory(moduleObj, moduleObj.exports, requireFn, filename, dirname);

  return moduleObj.exports as SandboxedExtensionModule;
}
