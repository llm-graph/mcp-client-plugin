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
    
    // The manager is created without errors
    expect(mcpManager).toBeDefined();
    
    // We can verify the nonExistentServer is in the config but not active
    expect(mcpManager.getClient("nonExistentServer")).toBeUndefined();
    
    // Verify the config was stored correctly
    const state = mcpManager._getState();
    expect(state.config).toEqual(config);
    expect(state.activeClients.nonExistentServer).toBeUndefined();
  });
});