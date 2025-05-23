import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createTemporaryFilesystem, cleanupTemporaryFilesystem } from '../testUtils.js';

// Mock pathUtils BEFORE importing the handler
// Mock pathUtils using vi.mock (hoisted)
const mockResolvePath = vi.fn<(userPath: string) => string>();
vi.mock('../../src/utils/pathUtils.js', () => ({
    PROJECT_ROOT: 'mocked/project/root', // Keep simple for now
    resolvePath: mockResolvePath,
}));

// Import the handler AFTER the mock
const { copyItemsToolDefinition } = await import('../../src/handlers/copyItems.js');

// Define the initial structure
const initialTestStructure = {
  'fileToCopy.txt': 'Copy me!',
  'dirToCopy': {
    'nestedFile.txt': 'I am nested.',
    'subDir': {
        'deepFile.js': '// deep'
    }
  },
  'existingTargetDir': {},
  'anotherFile.txt': 'Do not copy.',
};

let tempRootDir: string;

describe('handleCopyItems Integration Tests', () => {
  beforeEach(async () => {
    tempRootDir = await createTemporaryFilesystem(initialTestStructure);

    // Configure the mock resolvePath
    mockResolvePath.mockImplementation((relativePath: string): string => {
        if (path.isAbsolute(relativePath)) {
             throw new McpError(ErrorCode.InvalidParams, `Mocked Absolute paths are not allowed for ${relativePath}`);
        }
        const absolutePath = path.resolve(tempRootDir, relativePath);
        if (!absolutePath.startsWith(tempRootDir)) {
            throw new McpError(ErrorCode.InvalidRequest, `Mocked Path traversal detected for ${relativePath}`);
        }
        // For copy, the handler uses fs.cp. We don't need special checks here.
        return absolutePath;
    });
  });

  afterEach(async () => {
    await cleanupTemporaryFilesystem(tempRootDir);
    vi.clearAllMocks(); // Clear all mocks
  });

  it('should copy a file to a new location', async () => {
    const request = {
      operations: [{ source: 'fileToCopy.txt', destination: 'copiedFile.txt' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text); // Assuming similar return structure

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'fileToCopy.txt', destination: 'copiedFile.txt', success: true });

    // Verify copy
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToCopy.txt'))).resolves.toBeUndefined(); // Source should still exist
    const content = await fsPromises.readFile(path.join(tempRootDir, 'copiedFile.txt'), 'utf-8');
    expect(content).toBe('Copy me!');
  });

  it('should copy a file into an existing directory', async () => {
    const request = {
      operations: [{ source: 'fileToCopy.txt', destination: 'existingTargetDir/copiedFile.txt' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'fileToCopy.txt', destination: 'existingTargetDir/copiedFile.txt', success: true });

    // Verify copy
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToCopy.txt'))).resolves.toBeUndefined();
    const content = await fsPromises.readFile(path.join(tempRootDir, 'existingTargetDir/copiedFile.txt'), 'utf-8');
    expect(content).toBe('Copy me!');
  });

  it('should copy a directory recursively to a new location', async () => {
    const request = {
      operations: [{ source: 'dirToCopy', destination: 'copiedDir' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ source: 'dirToCopy', destination: 'copiedDir', success: true });

    // Verify copy
    await expect(fsPromises.access(path.join(tempRootDir, 'dirToCopy'))).resolves.toBeUndefined(); // Source dir still exists
    const stats = await fsPromises.stat(path.join(tempRootDir, 'copiedDir'));
    expect(stats.isDirectory()).toBe(true);
    const content1 = await fsPromises.readFile(path.join(tempRootDir, 'copiedDir/nestedFile.txt'), 'utf-8');
    expect(content1).toBe('I am nested.');
    const content2 = await fsPromises.readFile(path.join(tempRootDir, 'copiedDir/subDir/deepFile.js'), 'utf-8');
    expect(content2).toBe('// deep');
  });

   it('should copy a directory recursively into an existing directory', async () => {
     const request = {
       operations: [{ source: 'dirToCopy', destination: 'existingTargetDir/copiedDir' }],
     };
     const rawResult = await copyItemsToolDefinition.handler(request);
     const result = JSON.parse(rawResult.content[0].text);

     expect(result).toHaveLength(1);
     expect(result[0]).toEqual({ source: 'dirToCopy', destination: 'existingTargetDir/copiedDir', success: true });

     // Verify copy
     await expect(fsPromises.access(path.join(tempRootDir, 'dirToCopy'))).resolves.toBeUndefined();
     const stats = await fsPromises.stat(path.join(tempRootDir, 'existingTargetDir/copiedDir'));
     expect(stats.isDirectory()).toBe(true);
     const content1 = await fsPromises.readFile(path.join(tempRootDir, 'existingTargetDir/copiedDir/nestedFile.txt'), 'utf-8');
     expect(content1).toBe('I am nested.');
     const content2 = await fsPromises.readFile(path.join(tempRootDir, 'existingTargetDir/copiedDir/subDir/deepFile.js'), 'utf-8');
     expect(content2).toBe('// deep');
   });

  it('should return error if source does not exist', async () => {
    const request = {
      operations: [{ source: 'nonexistent.txt', destination: 'fail.txt' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toBe(`Source path not found: nonexistent.txt`); // Match handler's specific error
  });

  it('should return error if destination parent directory does not exist (fs.cp creates it)', async () => {
    // Note: fs.cp with recursive: true WILL create parent directories for the destination.
    // This test verifies that behavior.
    const request = {
      operations: [{ source: 'fileToCopy.txt', destination: 'newParentDir/copied.txt' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(true); // fs.cp creates parent dirs

    // Verify copy and parent creation
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToCopy.txt'))).resolves.toBeUndefined();
    await expect(fsPromises.access(path.join(tempRootDir, 'newParentDir/copied.txt'))).resolves.toBeUndefined();
    const stats = await fsPromises.stat(path.join(tempRootDir, 'newParentDir'));
    expect(stats.isDirectory()).toBe(true);
  });

   it('should overwrite if destination is an existing file by default', async () => {
    // Note: fs.cp default behavior might overwrite files. Let's test this.
    const request = {
      operations: [{ source: 'fileToCopy.txt', destination: 'anotherFile.txt' }],
    };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(true); // Assuming overwrite is default

    // Verify source file was copied and destination overwritten
    await expect(fsPromises.access(path.join(tempRootDir, 'fileToCopy.txt'))).resolves.toBeUndefined();
    const content = await fsPromises.readFile(path.join(tempRootDir, 'anotherFile.txt'), 'utf-8');
    expect(content).toBe('Copy me!'); // Content should be from fileToCopy.txt
  });

  it('should handle multiple operations with mixed results', async () => {
     const request = {
       operations: [
         { source: 'fileToCopy.txt', destination: 'copiedOkay.txt' }, // success
         { source: 'nonexistent.src', destination: 'nonexistent.dest' }, // failure (ENOENT src)
         { source: 'anotherFile.txt', destination: '../outside.txt' }, // failure (traversal dest mock)
       ],
     };
     const rawResult = await copyItemsToolDefinition.handler(request);
     const result = JSON.parse(rawResult.content[0].text);

     expect(result).toHaveLength(3);

     const success = result.find((r: any) => r.source === 'fileToCopy.txt');
     expect(success).toBeDefined();
     expect(success.success).toBe(true);

     const noSrc = result.find((r: any) => r.source === 'nonexistent.src');
     expect(noSrc).toBeDefined();
     expect(noSrc.success).toBe(false);
     expect(noSrc.error).toBe(`Source path not found: nonexistent.src`); // Match handler's specific error

     const traversal = result.find((r: any) => r.source === 'anotherFile.txt');
     expect(traversal).toBeDefined();
     expect(traversal.success).toBe(false);
     expect(traversal.error).toMatch(/Mocked Path traversal detected/); // Error from mock on destination path

     // Verify successful copy
     await expect(fsPromises.access(path.join(tempRootDir, 'copiedOkay.txt'))).resolves.toBeUndefined();
     // Verify file involved in failed traversal wasn't copied
     await expect(fsPromises.access(path.join(tempRootDir, '../outside.txt'))).rejects.toThrow(); // Should not exist outside root
   });


  it('should return error for absolute source path (caught by mock resolvePath)', async () => {
    const absoluteSource = path.resolve(tempRootDir, 'fileToCopy.txt');
    const request = { operations: [{ source: absoluteSource, destination: 'fail.txt' }] };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });

  it('should return error for absolute destination path (caught by mock resolvePath)', async () => {
    const absoluteDest = path.resolve(tempRootDir, 'fail.txt');
    const request = { operations: [{ source: 'fileToCopy.txt', destination: absoluteDest }] };
    const rawResult = await copyItemsToolDefinition.handler(request);
    const result = JSON.parse(rawResult.content[0].text);
    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(false);
    expect(result[0].error).toMatch(/Mocked Absolute paths are not allowed/);
  });


  it('should reject requests with empty operations array based on Zod schema', async () => {
    const request = { operations: [] };
    await expect(copyItemsToolDefinition.handler(request)).rejects.toThrow(McpError);
    await expect(copyItemsToolDefinition.handler(request)).rejects.toThrow(/Operations array cannot be empty/);
  });

});