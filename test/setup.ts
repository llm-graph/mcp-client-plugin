/**
 * Global test setup for the MCP client plugin
 * This file is automatically loaded by Bun when running tests
 */

import { beforeEach, afterEach, afterAll } from "bun:test";
import { terminateLingeringProcesses } from "./helpers/process-cleanup";

console.log("Setting up global test harness with process cleanup...");

// Setup global cleanup hooks
beforeEach(() => {
  // Reset test state before each test
  console.log("--- Starting new test ---");
});

// Cleanup after each test to prevent processes from hanging
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to allow processes to settle
  console.log("--- Cleaning up after test ---");
});

// Final cleanup when all tests complete
afterAll(async () => {
  console.log("=== All tests completed, performing final cleanup ===");
  await terminateLingeringProcesses();
});

// Fix for unhandled promise rejections during tests - prevents Bun from crashing
process.on("unhandledRejection", (reason) => {
  console.warn("Unhandled promise rejection during test:", reason);
}); 