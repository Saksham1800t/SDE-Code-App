import { describe, expect, it } from 'vitest';
import { toFileUrl } from './fileUrl';

describe('toFileUrl', () => {
  it('converts a Windows path with a drive letter, preserving the colon unescaped', () => {
    expect(toFileUrl('D:\\repo\\image.png')).toBe('file:///D:/repo/image.png');
  });

  it('converts a POSIX absolute path', () => {
    expect(toFileUrl('/home/user/repo/image.png')).toBe('file:///home/user/repo/image.png');
  });

  it('encodes spaces in the path', () => {
    expect(toFileUrl('D:\\my folder\\my image.png')).toBe('file:///D:/my%20folder/my%20image.png');
  });

  it('does not double-encode the drive letter colon as %3A', () => {
    expect(toFileUrl('D:\\a.png')).not.toContain('%3A');
  });

  it('handles a nested Windows path with multiple segments', () => {
    expect(toFileUrl('C:\\Users\\dev\\Projects\\assets\\logo.svg')).toBe('file:///C:/Users/dev/Projects/assets/logo.svg');
  });
});
