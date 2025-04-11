import { describe, expect, test } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("MCP Manager Simple E2E tests", () => {
  test("should create a manager instance", async () => {
    const config: ManagerConfig = {};
    const mcpManager = await manager(config);
    expect(mcpManager).toBeDefined();
    expect(typeof mcpManager.use).toBe("function");
    expect(typeof mcpManager.getClient).toBe("function");
    expect(typeof mcpManager.disconnectAll).toBe("function");
  });
}); 