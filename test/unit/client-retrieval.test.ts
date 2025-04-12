import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("Client Retrieval", () => {
  test("getClient(): Returns valid ClientAPI after successful use()", async () => {
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
      const client = result.getClient("echoServer");
      
      expect(client).toBeDefined();
      
      if (client) {
        expect(typeof client.ping).toBe("function");
        expect(typeof client.listTools).toBe("function");
        expect(typeof client.callTool).toBe("function");
        expect(typeof client.disconnect).toBe("function");
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("getClient(): Returns undefined for inactive server", async () => {
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
    
    // Without calling .use(), the client should be undefined
    const client = managerApi.getClient("inactiveServer");
    expect(client).toBeUndefined();
  });

  test("getClient(): Returns undefined for server name not in config", async () => {
    const config: ManagerConfig = {
      configuredServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        },
      },
    };

    const managerApi = manager(config);
    
    // Request a server that wasn't configured
    const client = managerApi.getClient("nonExistentServer");
    expect(client).toBeUndefined();
  });

  test("getClient(): Returns undefined after activation failure", async () => {
    const config: ManagerConfig = {
      failingServer: {
        transport: {
          type: "stdio",
          command: "non-existent-command",
          args: [],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      await managerApi.use("failingServer");
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      // Activation should fail
      expect(error).toBeDefined();
    }
    
    // getClient should return undefined after failed activation
    const client = managerApi.getClient("failingServer");
    expect(client).toBeUndefined();
  });

  test("getClient(): Returns distinct ClientAPI instances for different servers", async () => {
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
    
    try {
      // Activate both servers
      const result = await managerApi.use("server1").then(m => m.use("server2"));
      
      // Get clients for both servers
      const client1 = result.getClient("server1");
      const client2 = result.getClient("server2");
      
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
      
      // They should be distinct instances
      expect(client1).not.toBe(client2);
      
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("getClientAsync(): Waits for pending connection", async () => {
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      asyncServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      // Start connection but don't await it
      const connectionPromise = managerApi.use("asyncServer");
      
      // Immediately try to get the client, which should be undefined synchronously
      const syncClient = managerApi.getClient("asyncServer");
      expect(syncClient).toBeUndefined();
      
      // But async retrieval should wait for the connection
      const asyncClient = await managerApi.getClientAsync("asyncServer");
      
      // Now complete the original connection
      const connectedManager = await connectionPromise;
      
      // Both ways of getting the client should now work
      expect(asyncClient).toBeDefined();
      expect(connectedManager.getClient("asyncServer")).toBeDefined();
      
      // Clean up
      await connectedManager.disconnectAll();
    } catch (error) {
      await managerApi.disconnectAll();
      throw error;
    }
  });
}); 