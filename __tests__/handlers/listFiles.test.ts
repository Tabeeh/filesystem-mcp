// __tests__/handlers/listFiles.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { Stats, Dirent } from 'fs';
import { promises as fsPromises } from 'fs'; // Import actual fs promises
import path from 'path';
import os from 'os'; // Needed for mkdtemp prefix

// --- NO MORE jest.mock() for fs, pathUtils, glob ---

// --- Import Handler ---
// Handler will use actual dependencies now
import { listFilesToolDefinition } from '../../src/handlers/listFiles.js';
const { handler: handleListFiles, schema: ListFilesArgsSchema } = listFilesToolDefinition;

// --- Test Suite ---
describe('listFiles Handler (Integration)', () => {
  let tempTestDir: string | null = null; // To store the path of the temporary directory

  beforeEach(async () => {
    // Create a unique temporary directory for each test inside the project root
    try {
        // Create temp dir within the current working directory (project root)
        tempTestDir = await fsPromises.mkdtemp(path.join(process.cwd(), 'temp-test-listFiles-'));
    } catch (err) {
        console.error("Failed to create temp directory:", err);
        throw err; // Fail fast if setup fails
    }
  });

  afterEach(async () => {
    // Clean up the temporary directory after each test
    if (tempTestDir) {
      try {
        await fsPromises.rm(tempTestDir, { recursive: true, force: true });
        tempTestDir = null; // Reset path
      } catch (err) {
        console.error(`Failed to remove temp directory ${tempTestDir}:`, err);
        // Don't throw here, let other tests run if possible
      }
    }
  });

  it('should list files non-recursively without stats', async () => {
    if (!tempTestDir) throw new Error("Temp directory not created");
    const testDirPathRelative = path.relative(process.cwd(), tempTestDir); // Get relative path for handler arg

    // Create test files/dirs inside tempTestDir
    await fsPromises.writeFile(path.join(tempTestDir, 'file1.txt'), 'content1');
    await fsPromises.mkdir(path.join(tempTestDir, 'subdir'));
    await fsPromises.writeFile(path.join(tempTestDir, 'subdir', 'nested.txt'), 'content2');

    const args = { path: testDirPathRelative, recursive: false, include_stats: false };

    const result = await handleListFiles(args);
    const resultData = JSON.parse(result.content[0].text);

    // Paths should be relative to the project root
    expect(resultData).toEqual(expect.arrayContaining([
        `${testDirPathRelative}/file1.txt`.replace(/\\/g, '/'),
        `${testDirPathRelative}/subdir/`.replace(/\\/g, '/')
    ]));
    expect(resultData).toHaveLength(2);
  });

  it('should list files recursively with stats using glob', async () => {
      if (!tempTestDir) throw new Error("Temp directory not created");
      const testDirPathRelative = path.relative(process.cwd(), tempTestDir);
      const subDirPath = path.join(tempTestDir, 'nested');
      const fileAPath = path.join(tempTestDir, 'fileA.ts');
      const fileBPath = path.join(subDirPath, 'fileB.js');

      // Create structure
      await fsPromises.mkdir(subDirPath);
      await fsPromises.writeFile(fileAPath, '// content A');
      await fsPromises.writeFile(fileBPath, '// content B');

      const args = { path: testDirPathRelative, recursive: true, include_stats: true };

      const result = await handleListFiles(args);
      const resultData = JSON.parse(result.content[0].text);

      // Updated expectation to include the directory and check size correctly
      expect(resultData).toHaveLength(3);
      // Check against the actual structure returned by formatStats
      expect(resultData).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: `${testDirPathRelative}/fileA.ts`.replace(/\\/g, '/'), stats: expect.objectContaining({ isFile: true, isDirectory: false, size: 12 }) }),
          expect.objectContaining({ path: `${testDirPathRelative}/nested/`.replace(/\\/g, '/'), stats: expect.objectContaining({ isFile: false, isDirectory: true }) }), // Directories might have size 0 or vary
          expect.objectContaining({ path: `${testDirPathRelative}/nested/fileB.js`.replace(/\\/g, '/'), stats: expect.objectContaining({ isFile: true, isDirectory: false, size: 12 }) })
      ]));
  });

  it('should return stats for a single file path', async () => {
      if (!tempTestDir) throw new Error("Temp directory not created");
      const targetFilePath = path.join(tempTestDir, 'singleFile.txt');
      const targetFileRelativePath = path.relative(process.cwd(), targetFilePath);
      await fsPromises.writeFile(targetFilePath, 'hello');

      const args = { path: targetFileRelativePath };

      const result = await handleListFiles(args);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).not.toBeInstanceOf(Array);
      // Updated expectation to only check core properties
      // Check against the actual structure returned by formatStats
      // Note: listFiles with a single file path doesn't return 'name' or 'type' directly, only the formatted stats object
      expect(resultData).toEqual(expect.objectContaining({
          path: targetFileRelativePath.replace(/\\/g, '/'),
          // name: 'singleFile.txt', // Not returned by formatStats
          // type: 'file', // Not returned by formatStats
          isFile: true,
          isDirectory: false,
          size: 5,
          // Add other relevant checks if needed, e.g., mode, uid, gid
      }));
      // Optionally check that other properties exist if needed
      expect(resultData).toHaveProperty('mtime');
      expect(resultData).toHaveProperty('mode');
  });

  it('should throw McpError if path does not exist', async () => {
      const args = { path: 'nonexistent-dir/nonexistent-file.txt' };

      await expect(handleListFiles(args)).rejects.toThrow(McpError);
      await expect(handleListFiles(args)).rejects.toMatchObject({
          code: ErrorCode.InvalidRequest,
          message: expect.stringContaining('Path not found: nonexistent-dir/nonexistent-file.txt'),
      });
  });

  // Add more tests...
});