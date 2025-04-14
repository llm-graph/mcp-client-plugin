import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { manager } from '../../src';
import type { ManagerAPI, ClientAPI } from '../../src/types';

// Test directory setup
const TEST_DIR = join(process.cwd(), 'test-tmp-filesystem');
const TEST_FILE = join(TEST_DIR, 'test-file.txt');
const TEST_CONTENT = 'This is a test file content for MCP filesystem server';

// Define types for server responses
interface FileReadResult {
  content: Array<{ type: string; text: string }>;
}

interface FileWriteResult {
  success: boolean;
  path: string;
}

interface DirectoryCreateResult {
  success: boolean;
  path: string;
}

interface DirectoryListResult {
  content: Array<{ type: string; text: string }>;
}

interface SearchFilesResult {
  content: Array<{ type: string; text: string }>;
}

// Helper to extract text from content array responses
const extractText = (result: { content: Array<{ type: string; text: string }> }): string => {
  if (!result || !result.content || !Array.isArray(result.content)) {
    return '';
  }
  
  return result.content
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('');
};

// Helper to extract array items from content
const extractArrayItems = (result: { content: Array<{ type: string; text: string }> }): string[] => {
  const text = extractText(result);
  if (!text) return [];
  
  // Split the text into lines and filter out empty lines
  return text.split('\n').filter(line => line.trim().length > 0);
};

describe('Filesystem Server E2E Integration', () => {
  let managerInstance: ManagerAPI;
  let fsClient: ClientAPI;

  // Set up test environment
  beforeAll(async () => {
    // Create test directory and test file
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
    await writeFile(TEST_FILE, TEST_CONTENT);
  });

  // Clean up after tests
  afterAll(async () => {
    try {
      if (managerInstance) {
        await managerInstance.disconnectAll();
      }
      
      if (existsSync(TEST_DIR)) {
        await rm(TEST_DIR, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  });

  // Initialize manager before each test
  beforeEach(async () => {
    // Create manager configuration with filesystem server
    const config = {
      fileSystem: {
        transport: {
          type: 'stdio' as const,
          command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
          args: ['@modelcontextprotocol/server-filesystem', TEST_DIR],
          env: { DEBUG: 'true' }
        }
      }
    };

    // Initialize manager and connect to filesystem server
    managerInstance = await manager(config).use('fileSystem');
    
    // Get filesystem client
    fsClient = managerInstance.getClient('fileSystem')!;
    expect(fsClient).not.toBeUndefined();
  });

  test('should connect and initialize filesystem server', async () => {
    // Check server capabilities
    const capabilities = fsClient.getCapabilities();
    expect(capabilities).toBeDefined();
    
    // Test ping functionality
    let pingError = null;
    try {
      await fsClient.ping();
    } catch (err) {
      pingError = err;
    }
    expect(pingError).toBeNull();
  });

  test('should list available tools', async () => {
    const tools = await fsClient.listTools();
    
    // Verify filesystem tools exist
    expect(tools).toBeInstanceOf(Array);
    expect(tools.length).toBeGreaterThan(0);
    
    // Verify specific essential tools
    const toolNames = tools.map(tool => tool.name);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('list_directory');
  });

  test('should read file contents', async () => {
    // Read the test file
    const result = await fsClient.callTool<FileReadResult>('read_file', {
      path: TEST_FILE
    });
    
    // Verify result structure
    expect(result).toBeDefined();
    expect(result.content).toBeInstanceOf(Array);
    
    // Extract and verify text content
    const fileContent = extractText(result);
    expect(fileContent).toBe(TEST_CONTENT);
  });

  test('should write to file and read back', async () => {
    // Create a new file path
    const newFileName = 'new-test-file.txt';
    const newFilePath = join(TEST_DIR, newFileName);
    const newContent = 'This is new content written by the MCP test';
    
    // Write the file
    const writeResult = await fsClient.callTool<FileWriteResult>('write_file', {
      path: newFilePath,
      content: newContent
    });
    
    expect(writeResult).toBeDefined();
    
    // Read the file back
    const readResult = await fsClient.callTool<FileReadResult>('read_file', {
      path: newFilePath
    });
    
    // Extract and verify text content
    const fileContent = extractText(readResult);
    expect(fileContent).toBe(newContent);
  });

  test('should list directory contents', async () => {
    // List the test directory
    const result = await fsClient.callTool<DirectoryListResult>('list_directory', {
      path: TEST_DIR
    });
    
    // Extract directory listing
    const contents = extractArrayItems(result);
    
    // Verify the directory listing
    expect(Array.isArray(contents)).toBe(true);
    expect(contents.length).toBeGreaterThan(0);
    
    // Find the test file in the listing (could be prefixed with [FILE])
    const hasTestFile = contents.some(item => item.includes('test-file.txt'));
    expect(hasTestFile).toBe(true);
  });

  test('should create directories', async () => {
    // Create a new directory
    const newDirName = 'new-test-dir';
    const newDirPath = join(TEST_DIR, newDirName);
    
    // Create directory
    const createResult = await fsClient.callTool<DirectoryCreateResult>('create_directory', {
      path: newDirPath
    });
    
    expect(createResult).toBeDefined();
    
    // List directory to verify it was created
    const listResult = await fsClient.callTool<DirectoryListResult>('list_directory', {
      path: TEST_DIR
    });
    
    // Extract directory listing
    const contents = extractArrayItems(listResult);
    
    // Check if the new directory is in the listing
    const hasDirEntry = contents.some(item => item.includes(newDirName));
    expect(hasDirEntry).toBe(true);
  });

  test('should perform file operations end-to-end', async () => {
    // This test will be a comprehensive verification that our client plugin
    // works correctly with the filesystem MCP server by performing a series of operations

    // 1. Create a test directory
    const testSubDir = join(TEST_DIR, 'e2e-subdir');
    await fsClient.callTool('create_directory', { path: testSubDir });

    // 2. Write a file in the directory
    const testFilePath = join(testSubDir, 'e2e-test.txt');
    const fileContent = 'This is an e2e test file';
    await fsClient.callTool('write_file', {
      path: testFilePath,
      content: fileContent
    });

    // 3. Verify the file exists in the directory
    const listResult = await fsClient.callTool<DirectoryListResult>('list_directory', {
      path: testSubDir
    });
    
    const contents = extractArrayItems(listResult);
    const hasFile = contents.some(item => item.includes('e2e-test.txt'));
    expect(hasFile).toBe(true);

    // 4. Read the file to verify content
    const readResult = await fsClient.callTool<FileReadResult>('read_file', {
      path: testFilePath
    });
    
    expect(extractText(readResult)).toBe(fileContent);

    // This test passing demonstrates that our mcp-client-plugin works correctly
    // with the filesystem server through the complete lifecycle of file operations
  });
}); 