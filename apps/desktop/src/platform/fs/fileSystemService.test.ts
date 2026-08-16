import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileSystemService } from './fileSystemService';
import { FakeLogService } from '../log';

describe('FileSystemService', () => {
  let tmpDir: string;
  let log: FakeLogService;
  let service: FileSystemService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sde-code-fs-test-'));
    log = new FakeLogService();
    service = new FileSystemService(log);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readDir lists files and directories with correct isDirectory/size', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(tmpDir, 'sub'));

    const entries = await service.readDir(tmpDir);

    const file = entries.find((e) => e.name === 'a.txt');
    const dir = entries.find((e) => e.name === 'sub');
    expect(file).toMatchObject({ isDirectory: false, size: 5 });
    expect(dir).toMatchObject({ isDirectory: true });
  });

  it('readFile returns file contents', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world');
    await expect(service.readFile(path.join(tmpDir, 'a.txt'))).resolves.toBe('hello world');
  });

  it('writeFile overwrites contents and returns true', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'old');

    await expect(service.writeFile(file, 'new')).resolves.toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('new');
  });

  it('createFile creates an empty file and returns true', async () => {
    const file = path.join(tmpDir, 'new-file.txt');
    await expect(service.createFile(file)).resolves.toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('');
  });

  it('createDirectory creates nested directories and returns true', async () => {
    const dir = path.join(tmpDir, 'a', 'b', 'c');
    await expect(service.createDirectory(dir)).resolves.toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('logs and rethrows when readFile fails on a real missing path', async () => {
    await expect(service.readFile(path.join(tmpDir, 'does-not-exist.txt'))).rejects.toThrow();
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('Failed to read file:');
  });

  it('deleteFile removes a real file and returns true', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'hello');

    await expect(service.deleteFile(file)).resolves.toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('logs and rethrows when deleteFile fails on a real missing path', async () => {
    await expect(service.deleteFile(path.join(tmpDir, 'does-not-exist.txt'))).rejects.toThrow();
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('Failed to delete file:');
  });

  it('deletePath removes a real file and returns true', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'hello');

    await expect(service.deletePath(file)).resolves.toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('deletePath recursively removes a real directory and returns true', async () => {
    const dir = path.join(tmpDir, 'sub');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'nested.txt'), 'hello');

    await expect(service.deletePath(dir)).resolves.toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('renamePath renames a real file and returns true', async () => {
    const oldFile = path.join(tmpDir, 'old.txt');
    const newFile = path.join(tmpDir, 'new.txt');
    fs.writeFileSync(oldFile, 'hello');

    await expect(service.renamePath(oldFile, newFile)).resolves.toBe(true);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.readFileSync(newFile, 'utf-8')).toBe('hello');
  });

  it('renamePath renames a real directory and returns true', async () => {
    const oldDir = path.join(tmpDir, 'old-dir');
    const newDir = path.join(tmpDir, 'new-dir');
    fs.mkdirSync(oldDir);
    fs.writeFileSync(path.join(oldDir, 'inside.txt'), 'hello');

    await expect(service.renamePath(oldDir, newDir)).resolves.toBe(true);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.readFileSync(path.join(newDir, 'inside.txt'), 'utf-8')).toBe('hello');
  });

  it('logs and rethrows when renamePath fails on a real missing source path', async () => {
    await expect(service.renamePath(path.join(tmpDir, 'does-not-exist.txt'), path.join(tmpDir, 'new.txt'))).rejects.toThrow();
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('Failed to rename path:');
  });
});
