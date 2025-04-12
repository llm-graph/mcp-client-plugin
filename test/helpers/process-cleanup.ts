/**
 * This helper script provides utilities to forcefully terminate any lingering processes
 * that might be causing tests to hang. It helps avoid race conditions during test execution.
 */

import { afterEach, afterAll } from "bun:test";

/**
 * Force terminate any running bun processes
 * This is an aggressive approach intended for test environments only
 */
export async function terminateLingeringProcesses(): Promise<void> {
  console.log("Cleaning up any lingering bun processes...");
  
  try {
    // For Windows
    if (process.platform === "win32") {
      const { exited } = Bun.spawn({
        cmd: ["powershell", "-Command", "Get-Process -Name bun* | Stop-Process -Force"],
        stdio: ["ignore", "pipe", "pipe"]
      });
      await exited;
    } 
    // For Unix-like systems (macOS, Linux)
    else {
      const { exited } = Bun.spawn({
        cmd: ["pkill", "-f", "bun"],
        stdio: ["ignore", "pipe", "pipe"]
      });
      await exited.catch(() => {
        // pkill returns non-zero if no matching processes, which is fine
      });
    }
    console.log("Process cleanup completed successfully");
  } catch (error) {
    console.error("Error during process cleanup:", error);
  }
}

// Always run cleanup after each test file completes
afterAll(async () => {
  await terminateLingeringProcesses();
});

// Export a function that can be called after individual tests if needed
export function setupProcessCleanup() {
  afterEach(async () => {
    await terminateLingeringProcesses();
  });
} 