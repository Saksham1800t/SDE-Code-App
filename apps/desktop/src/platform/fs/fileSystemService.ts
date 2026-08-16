import fs from 'fs';
import path from 'path';
import type { FsDirEntry } from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';

export interface IFileSystemService {
  readDir(dirPath: string): Promise<FsDirEntry[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<boolean>;
  createFile(filePath: string): Promise<boolean>;
  createDirectory(dirPath: string): Promise<boolean>;
  deleteFile(filePath: string): Promise<boolean>;
  deletePath(targetPath: string): Promise<boolean>;
  renamePath(oldPath: string, newPath: string): Promise<boolean>;
}

export const IFileSystemService = createServiceIdentifier<IFileSystemService>('fileSystemService');

/** Migrated from inline closures in host/ipc.ts's fs:* handlers into an injectable instance logging through ILogService; covers only pure filesystem operations — fs:openFolder stays inline since it isn't one. */
export class FileSystemService implements IFileSystemService {
  static readonly inject = [ILogService] as const;
  constructor(private readonly logService: ILogService) {}

  async readDir(dirPath: string): Promise<FsDirEntry[]> {
    try {
      const items = fs.readdirSync(dirPath);
      return items.map((item) => {
        const fullPath = path.join(dirPath, item);
        const stats = fs.statSync(fullPath);
        return {
          name: item,
          path: fullPath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
        };
      });
    } catch (err) {
      this.logService.error('Failed to read directory:', err);
      throw err;
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      this.logService.error('Failed to read file:', err);
      throw err;
    }
  }

  async writeFile(filePath: string, content: string): Promise<boolean> {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      this.logService.error('Failed to write file:', err);
      throw err;
    }
  }

  async createFile(filePath: string): Promise<boolean> {
    try {
      fs.writeFileSync(filePath, '', 'utf-8');
      return true;
    } catch (err) {
      this.logService.error('Failed to create file:', err);
      throw err;
    }
  }

  async createDirectory(dirPath: string): Promise<boolean> {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return true;
    } catch (err) {
      this.logService.error('Failed to create directory:', err);
      throw err;
    }
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      this.logService.error('Failed to delete file:', err);
      throw err;
    }
  }

  async deletePath(targetPath: string): Promise<boolean> {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    } catch (err) {
      this.logService.error('Failed to delete path:', err);
      throw err;
    }
  }

  async renamePath(oldPath: string, newPath: string): Promise<boolean> {
    try {
      fs.renameSync(oldPath, newPath);
      return true;
    } catch (err) {
      this.logService.error('Failed to rename path:', err);
      throw err;
    }
  }
}
