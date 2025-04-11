import { describe, expect, test } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("MCP Manager E2E tests", () => {
  test("should handle connection errors gracefully", async () => {
    // Create config with a non-existent server
    const config: ManagerConfig = {
      nonExistentServer: {
        transport: {
          type: "stdio",
          command: "non-existent-command",
          args: [],
        }
      }
    };
    
    const mcpManager = await manager(config);
    
    try {
      // The use method should throw an error since the command doesn't exist
      await mcpManager.use("nonExistentServer");
      expect("should not reach here").toBe("should not reach here");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Failed to spawn process");
    }
  });
});