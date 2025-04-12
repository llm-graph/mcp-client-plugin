import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig, ManagerOptions } from "../../src/types";

describe("Manager Initialization", () => {
  test("manager(): Successfully initializes with a valid stdio configuration", async () => {
    const config: ManagerConfig = {
      testServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        },
      },
    };

    const result = manager(config);
    expect(result).toBeDefined();
    expect(typeof result.use).toBe("function");
    expect(typeof result.getClient).toBe("function");
    expect(typeof result.disconnectAll).toBe("function");
  });

  test("manager(): Successfully initializes with a valid SSE configuration", async () => {
    const config: ManagerConfig = {
      testServer: {
        transport: {
          type: "sse",
          url: "http://localhost:8000/sse",
        },
      },
    };

    const result = manager(config);
    expect(result).toBeDefined();
    expect(typeof result.use).toBe("function");
    expect(typeof result.getClient).toBe("function");
    expect(typeof result.disconnectAll).toBe("function");
  });

  test("manager(): Successfully initializes with a mixed stdio and SSE configuration", async () => {
    const config: ManagerConfig = {
      stdioServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        },
      },
      sseServer: {
        transport: {
          type: "sse",
          url: "http://localhost:8000/sse",
        },
      },
    };

    const result = manager(config);
    expect(result).toBeDefined();
    expect(typeof result.use).toBe("function");
    expect(typeof result.getClient).toBe("function");
    expect(typeof result.disconnectAll).toBe("function");
    
    // Test internal state
    const state = result._getState();
    expect(state.config).toEqual(config);
    expect(state.activeClients).toEqual({});
  });

  test("manager(): Handles initialization with an empty configuration", async () => {
    const config: ManagerConfig = {};
    const result = manager(config);
    
    expect(result).toBeDefined();
    expect(typeof result.use).toBe("function");
    expect(typeof result.getClient).toBe("function");
    expect(typeof result.disconnectAll).toBe("function");
    
    const state = result._getState();
    expect(state.config).toEqual({});
    expect(state.activeClients).toEqual({});
  });

  test("manager(): Stores notification handler correctly", async () => {
    const notificationHandler = (serverName: string, notification: unknown) => {
      // Use the parameters to avoid TypeScript errors
      const serverInfo = `Server: ${serverName}`;
      const notificationInfo = `Notification: ${JSON.stringify(notification)}`;
      
      // These are just to silence TypeScript, they're not actually used in the test
      return { serverInfo, notificationInfo };
    };
    
    const options: ManagerOptions = {
      onNotification: notificationHandler,
    };
    
    const config: ManagerConfig = {
      testServer: {
        transport: {
          type: "stdio",
          command: "echo",
          args: ["test"],
        },
      },
    };

    const result = manager(config, options);
    const state = result._getState();
    
    expect(state.options.onNotification).toBe(notificationHandler);
  });
}); 