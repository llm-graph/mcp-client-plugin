import { join } from "path";
import { mkdir, unlink, writeFile } from "fs/promises";
import type { ManagerConfig } from "../../src/types";

export const setupTestEnv = async (): Promise<string> => {
  const tempDir = join("test", "e2e", "temp", `test-${Date.now()}`);
  
  try {
    // Create temp directory
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  } catch (err) {
    console.error("Failed to create temp directory:", err);
    throw err;
  }
};

export const createEchoServerConfig = (testServerPath: string): ManagerConfig => {
  return {
    testServer: {
      transport: {
        type: "stdio",
        command: "bun",
        args: [testServerPath],
      },
    },
  };
};

export const createServerScriptFile = async (tempDir: string, scriptContent: string): Promise<string> => {
  const scriptPath = join(tempDir, `server-${Date.now()}.ts`);
  
  try {
    await writeFile(scriptPath, scriptContent, "utf-8");
    return scriptPath;
  } catch (err) {
    console.error("Failed to create server script file:", err);
    throw err;
  }
};

export const cleanupTestEnv = async (filesToDelete: string[]): Promise<void> => {
  const deletePromises = filesToDelete.map(async (filePath) => {
    try {
      await unlink(filePath);
    } catch (err) {
      // Ignore errors if file doesn't exist or is already deleted
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Warning: Failed to delete ${filePath}:`, err);
      }
    }
  });
  
  await Promise.all(deletePromises);
};

// Add this function to help with debugging
export const addDebugLogs = (scriptContent: string): string => {
  return `
    ${scriptContent}
    
    // Add some debug logging
    console.error("Server script started");
    
    // Log all received requests for debugging
    stdin.on("data", (chunk) => {
      console.error("Received data:", chunk.toString());
    });
  `;
}; 