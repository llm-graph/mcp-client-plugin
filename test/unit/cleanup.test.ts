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
      
      // After disconnection, the client should no longer be available
      const updatedClient = activatedManager.getClient("echoServer");
      expect(updatedClient).toBeUndefined();
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
    
    // After disconnection, no clients should be available
    const updatedClient1 = activatedManager.getClient("server1");
    const updatedClient2 = activatedManager.getClient("server2");
    
    expect(updatedClient1).toBeUndefined();
    expect(updatedClient2).toBeUndefined();
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
      
      // Verify that getClient now returns undefined
      const clientAfterDisconnect = activatedManager.getClient("echoServer");
      expect(clientAfterDisconnect).toBeUndefined();
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
    
    // Call disconnectAll twice
    await activatedManager.disconnectAll();
    await activatedManager.disconnectAll();
    
    // This test passes if both calls complete without errors
  });
}); 