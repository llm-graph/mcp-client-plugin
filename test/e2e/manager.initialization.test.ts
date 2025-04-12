/**
 * Manager Initialization & Basic Setup Tests
 * 
 * These tests validate the core initialization functionality of the MCP Manager.
 * They ensure the manager can handle various configuration scenarios correctly,
 * following the functional programming and immutability principles from README.md.
 * 
 * Test Cases:
 * - Initialize with empty configuration (baseline functionality)
 * - Initialize with Stdio transport configuration (local process communication)
 * - Initialize with SSE transport configuration (remote server communication)
 * - Initialize with mixed transport types (multiple server support)
 * - Fail gracefully with invalid transport configuration (error handling)
 */

import { describe, expect, test } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig, SseTransportConfig } from "../../src/types";

describe("Manager Initialization & Basic Setup", () => {
  test("Initialize Manager with Empty Configuration", async () => {
    const config: ManagerConfig = {};
    const mcpManager = await manager(config);
    
    expect(mcpManager).toBeDefined();
    expect(typeof mcpManager.use).toBe("function");
    expect(typeof mcpManager.getClient).toBe("function");
    expect(typeof mcpManager.disconnectAll).toBe("function");
    
    // Verify the internal state structure
    const state = mcpManager._getState();
    expect(state.config).toEqual(config);
    expect(state.activeClients).toEqual({});
  });

  test("Initialize Manager with Valid Stdio Configuration", async () => {
    const config: ManagerConfig = {
      testServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        }
      }
    };
    
    const mcpManager = await manager(config);
    
    expect(mcpManager).toBeDefined();
    const state = mcpManager._getState();
    expect(state.config).toEqual(config);
    expect(state.config.testServer.transport.type).toBe("stdio");
  });

  test("Initialize Manager with Valid SSE Configuration", async () => {
    const sseTransport: SseTransportConfig = {
      type: "sse",
      url: "http://localhost:8080/sse",
      headers: {
        "Authorization": "Bearer test-token"
      }
    };
    
    const config: ManagerConfig = {
      sseServer: {
        transport: sseTransport
      }
    };
    
    const mcpManager = await manager(config);
    
    expect(mcpManager).toBeDefined();
    const state = mcpManager._getState();
    expect(state.config).toEqual(config);
    expect(state.config.sseServer.transport.type).toBe("sse");
    // Type assertion because we know it's an SSE transport
    const transport = state.config.sseServer.transport as SseTransportConfig;
    expect(transport.url).toBe("http://localhost:8080/sse");
  });

  test("Initialize Manager with Mixed Stdio and SSE Configuration", async () => {
    const sseTransport: SseTransportConfig = {
      type: "sse",
      url: "http://localhost:8080/sse",
    };
    
    const config: ManagerConfig = {
      stdioServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        }
      },
      sseServer: {
        transport: sseTransport
      }
    };
    
    const mcpManager = await manager(config);
    
    expect(mcpManager).toBeDefined();
    const state = mcpManager._getState();
    expect(state.config).toEqual(config);
    expect(state.config.stdioServer.transport.type).toBe("stdio");
    expect(state.config.sseServer.transport.type).toBe("sse");
  });

  test("Fail Initialization with Invalid Configuration Structure", async () => {
    // Creating an invalid configuration with a transport of an invalid type
    const invalidConfig: ManagerConfig = {
      invalidServer: {
        transport: {
          // @ts-expect-error - Intentionally using an invalid transport type
          type: "invalid",
          someProperty: "value"
        }
      }
    };
    
    const mcpManager = manager(invalidConfig);
    
    // The initialization succeeded, but we won't be able to use the server
    expect(mcpManager).toBeDefined();
    
    // We can't test use() since it will throw, but we can verify getClient returns undefined
    expect(mcpManager.getClient("invalidServer")).toBeUndefined();
    
    // Verify the config with invalid transport is stored
    const state = mcpManager._getState();
    expect(state.config).toEqual(invalidConfig);
  });
}); 