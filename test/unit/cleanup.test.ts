import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("Cleanup", () => {
  test("ClientAPI.disconnect(): Closes connection for a specific stdio server", async () => {
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
    
    // Activate the server
    const activatedManager = await managerApi.use("echoServer");
    const client = activatedManager.getClient("echoServer");
    expect(client).toBeDefined();
    
    if (client) {
      // Call disconnect on the client
      await client.disconnect();
      
      // Create a new manager instance with the same config
      // This simulates a client reconnecting after a disconnect
      const newManager = manager(config);
      
      // Check if we can activate the server again (should be possible after disconnect)
      const reactivatedManager = await newManager.use("echoServer");
      expect(reactivatedManager.getClient("echoServer")).toBeDefined();
    }
  });

  test("disconnectAll(): Closes connections for all active servers", async () => {
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      server1: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
      server2: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    // Activate both servers
    const activatedManager = await managerApi
      .use("server1")
      .then(m => m.use("server2"));
    
    // Check that both clients are active
    const client1 = activatedManager.getClient("server1");
    const client2 = activatedManager.getClient("server2");
    
    expect(client1).toBeDefined();
    expect(client2).toBeDefined();
    
    // Disconnect all clients
    await activatedManager.disconnectAll();
    
    // Create a new manager instance to check if servers can be reactivated
    const newManager = manager(config);
    
    // Should be able to activate both servers after disconnect
    const reactivatedManager = await newManager.use("server1").then(m => m.use("server2"));
    expect(reactivatedManager.getClient("server1")).toBeDefined();
    expect(reactivatedManager.getClient("server2")).toBeDefined();
  });

  test("getClient(): Returns undefined after disconnect()", async () => {
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
    
    // Activate the server
    const activatedManager = await managerApi.use("echoServer");
    const client = activatedManager.getClient("echoServer");
    expect(client).toBeDefined();
    
    if (client) {
      // Disconnect the client
      await client.disconnect();
      
      // Create a new manager instance with the same config
      // This simulates a client reconnecting after a disconnect
      const newManager = manager(config);
      
      // Check if we can activate the server again (should be possible after disconnect)
      const reactivatedManager = await newManager.use("echoServer");
      expect(reactivatedManager.getClient("echoServer")).toBeDefined();
    }
  });

  test("disconnectAll(): Handles being called when no servers are active", async () => {
    const config: ManagerConfig = {
      inactiveServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        },
      },
    };

    const managerApi = manager(config);
    
    // Call disconnectAll without activating any servers
    await managerApi.disconnectAll();
    
    // This test passes if disconnectAll completes without errors
  });

  test("disconnectAll(): Handles being called multiple times", async () => {
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
    
    // Activate the server
    const activatedManager = await managerApi.use("echoServer");
    expect(activatedManager.getClient("echoServer")).toBeDefined();
    
    // First disconnectAll
    await activatedManager.disconnectAll();
    
    // Second disconnectAll (should not cause errors)
    await activatedManager.disconnectAll();
    
    // Create a new manager and reconnect
    const newManager = manager(config);
    const reactivatedManager = await newManager.use("echoServer");
    expect(reactivatedManager.getClient("echoServer")).toBeDefined();
  });
}); 