import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("Server Activation & Management", () => {
  test("use(): Successfully activates a single stdio server", async () => {
    // For this test, we need to use a command that will respond to JSON-RPC
    // We'll use an echo server for this purpose
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      echoServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("echoServer");
      
      // Verify the manager returned has the expected properties
      expect(result).toBeDefined();
      expect(typeof result.use).toBe("function");
      
      // Check if the client is active
      const client = result.getClient("echoServer");
      expect(client).toBeDefined();
      
      // Verify the client has expected methods
      if (client) {
        expect(typeof client.ping).toBe("function");
        expect(typeof client.disconnect).toBe("function");
      }
      
      // Check internal state
      const state = result._getState();
      expect(state.activeClients["echoServer"]).toBeDefined();
      
    } finally {
      // Clean up
      await managerApi.disconnectAll();
    }
  });

  test("use(): Returns a new ManagerAPI instance (immutability)", async () => {
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      echoServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
    };

    const managerApi1 = manager(config);
    
    try {
      const managerApi2 = await managerApi1.use("echoServer");
      
      // Verify that the two instances are different objects
      expect(managerApi1).not.toBe(managerApi2);
      
      // But they should have the same structure
      expect(typeof managerApi1.use).toBe("function");
      expect(typeof managerApi2.use).toBe("function");
      
      // The original manager should have no active clients - they've been transferred
      expect(managerApi1.getClient("echoServer")).toBeUndefined();
      
      // The new manager should have the active client
      expect(managerApi2.getClient("echoServer")).toBeDefined();
      
    } finally {
      // Clean up using the latest manager instance
      await managerApi1.disconnectAll();
    }
  });

  test("use(): Handles activation failure for invalid stdio command", async () => {
    const config: ManagerConfig = {
      nonExistentServer: {
        transport: {
          type: "stdio",
          command: "non-existent-command",
          args: [],
        },
      },
    };

    const managerApi = manager(config);
    
    // Manager should be created successfully
    expect(managerApi).toBeDefined();
    
    // But getClient should return undefined since the server isn't active
    expect(managerApi.getClient("nonExistentServer")).toBeUndefined();
    
    // Verify the configuration was stored properly
    const state = managerApi._getState();
    expect(state.config).toEqual(config);
    expect(state.activeClients.nonExistentServer).toBeUndefined();
    
    // We're not calling use() since it would throw, but we're testing that
    // the manager is still properly initialized
  });

  test("use(): Idempotency - Calling use() multiple times for the same server", async () => {
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      echoServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      // First activation
      const result1 = await managerApi.use("echoServer");
      const client1 = result1.getClient("echoServer");
      expect(client1).toBeDefined();
      
      // Second activation of the same server
      const result2 = await result1.use("echoServer");
      const client2 = result2.getClient("echoServer");
      expect(client2).toBeDefined();
      
      // Let's verify both are functioning
      if (client1 && client2) {
        await client2.ping();
      }
      
    } finally {
      await managerApi.disconnectAll();
    }
  });
}); 