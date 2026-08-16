/** 'project:index' stays a raw ipcMain.handle (needs `event` for progress push events); this type just gives the invoker a real type. */
export type ProjectIndexerIpcContract = {
  'project:index': (projectId: string, workspacePath: string) => Promise<number>;
  'project:reindexFile': (projectId: string, workspacePath: string, filePath: string) => Promise<number>;
};
