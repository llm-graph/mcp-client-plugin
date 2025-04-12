import { afterAll } from "bun:test";

// Function to forcefully terminate all bun processes
async function terminateAllBunProcesses() {
  console.log("Performing aggressive cleanup of all test processes...");
  
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

// Run cleanup after all tests
afterAll(async () => {
  await terminateAllBunProcesses();
}); 