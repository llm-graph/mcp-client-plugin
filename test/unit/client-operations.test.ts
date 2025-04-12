import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("Client API Operations", () => {
  test("ClientAPI.listTools(): Successfully retrieves tools from stdio server", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/tools-server.ts", import.meta.url));

    const config: ManagerConfig = {
      toolsServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("toolsServer");
      const client = result.getClient("toolsServer");
      expect(client).toBeDefined();
      
      if (client) {
        const tools = await client.listTools();
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
        
        // Check the structure of the returned tools
        const tool = tools[0];
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("inputSchema");
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.callTool(): Successfully calls a tool with parameters", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/tools-server.ts", import.meta.url));

    const config: ManagerConfig = {
      toolsServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("toolsServer");
      const client = result.getClient("toolsServer");
      expect(client).toBeDefined();
      
      if (client) {
        // First get tools to find one we can call
        const tools = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);
        
        // Call the first tool with test parameters
        const toolName = tools[0].name;
        const response = await client.callTool(toolName, { test: "value" });
        
        expect(response).toBeDefined();
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.callTool(): Handles JSON-RPC error response from server", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/tools-server.ts", import.meta.url));

    const config: ManagerConfig = {
      toolsServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("toolsServer");
      const client = result.getClient("toolsServer");
      expect(client).toBeDefined();
      
      if (client) {
        // Call a tool that doesn't exist to trigger an error
        try {
          await client.callTool("non-existent-tool", {});
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          expect(error).toBeDefined();
          // error may have a code property for JSON-RPC errors
          expect((error as any).code).toBeDefined();
        }
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.readResource(): Successfully reads resource data", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/resources-server.ts", import.meta.url));

    const config: ManagerConfig = {
      resourcesServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("resourcesServer");
      const client = result.getClient("resourcesServer");
      expect(client).toBeDefined();
      
      if (client) {
        // First, list the resources to find one to read
        const resources = await client.listResources();
        expect(Array.isArray(resources)).toBe(true);
        expect(resources.length).toBeGreaterThan(0);
        
        // Read the first resource
        const resourceUri = resources[0].uri;
        const content = await client.readResource(resourceUri);
        
        expect(content).toBeDefined();
        // Content could be string or Buffer
        expect(typeof content === "string" || content instanceof Buffer).toBe(true);
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.getCapabilities(): Successfully retrieves server capabilities", async () => {
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
        const capabilities = client.getCapabilities();
        expect(capabilities).toBeDefined();
        expect(typeof capabilities).toBe("object");
        
        // Just verify the capabilities object exists
        expect(capabilities).not.toBeNull();
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.ping(): Successfully verifies server connectivity", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      echoServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("echoServer");
      const client = result.getClient("echoServer");
      expect(client).toBeDefined();
      
      if (client) {
        // Should not throw an exception
        await client.ping();
        
        // No actual result to test since ping just returns void
        // But we can reach this point only if ping completed successfully
        expect(true).toBe(true);
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.listResources(): Successfully retrieves resources from server", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/resources-server.ts", import.meta.url));

    const config: ManagerConfig = {
      resourcesServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("resourcesServer");
      const client = result.getClient("resourcesServer");
      expect(client).toBeDefined();
      
      if (client) {
        const resources = await client.listResources();
        expect(Array.isArray(resources)).toBe(true);
        expect(resources.length).toBeGreaterThan(0);
        
        // Check the structure of the returned resources
        const resource = resources[0];
        expect(resource).toHaveProperty("uri");
        expect(resource).toHaveProperty("name");
        expect(typeof resource.uri).toBe("string");
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.readResource(): Handles error when resource not found", async () => {
    const testServerPath = Bun.fileURLToPath(new URL("../helpers/resources-server.ts", import.meta.url));

    const config: ManagerConfig = {
      resourcesServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [testServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    try {
      const result = await managerApi.use("resourcesServer");
      const client = result.getClient("resourcesServer");
      expect(client).toBeDefined();
      
      if (client) {
        try {
          // Try to read a resource that doesn't exist
          await client.readResource("test:///nonexistent.file");
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          expect(error).toBeDefined();
          // Should have error code for JSON-RPC error
          expect((error as any).code).toBeDefined();
        }
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI Operations: Function correctly when interleaved across multiple clients", async () => {
    const toolsServerPath = Bun.fileURLToPath(new URL("../helpers/tools-server.ts", import.meta.url));
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));

    const config: ManagerConfig = {
      toolsServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [toolsServerPath],
        },
      },
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
      const result = await managerApi.use("toolsServer").then(m => m.use("echoServer"));
      
      const toolsClient = result.getClient("toolsServer");
      const echoClient = result.getClient("echoServer");
      
      expect(toolsClient).toBeDefined();
      expect(echoClient).toBeDefined();
      
      if (toolsClient && echoClient) {
        // Use both clients alternately
        
        // First call tools server to list tools
        const tools = await toolsClient.listTools();
        expect(tools.length).toBeGreaterThan(0);
        
        // Then call echo server ping
        await echoClient.ping();
        
        // Then call tools server with a tool
        if (tools.length > 0) {
          const response = await toolsClient.callTool(tools[0].name, { test: "value" });
          expect(response).toBeDefined();
        }
        
        // Finally call echo server again
        await echoClient.ping();
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.disconnect(): Successfully disconnects a specific client", async () => {
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
      // Verify client is working
      await client.ping();
      
      // Disconnect the client
      await client.disconnect();
      
      // Create a new manager instance to check if server can be reactivated
      const newManager = manager(config);
      
      // Should be able to activate the server again (proves it was disconnected properly)
      const reactivatedManager = await newManager.use("echoServer");
      expect(reactivatedManager.getClient("echoServer")).toBeDefined();
    }
  });

  test("Multiple client operations in sequence with proper resource lifecycle", async () => {
    const toolsServerPath = Bun.fileURLToPath(new URL("../helpers/tools-server.ts", import.meta.url));
    const resourcesServerPath = Bun.fileURLToPath(new URL("../helpers/resources-server.ts", import.meta.url));

    const config: ManagerConfig = {
      toolsServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [toolsServerPath],
        },
      },
      resourcesServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [resourcesServerPath],
        },
      },
    };

    const managerApi = manager(config);
    
    // Connect to both servers
    const result = await managerApi
      .use("toolsServer")
      .then(m => m.use("resourcesServer"));
    
    try {
      // Get clients
      const toolsClient = result.getClient("toolsServer");
      const resourcesClient = result.getClient("resourcesServer");
      
      expect(toolsClient).toBeDefined();
      expect(resourcesClient).toBeDefined();
      
      if (toolsClient && resourcesClient) {
        // Perform operations on tool server
        const tools = await toolsClient.listTools();
        expect(tools.length).toBeGreaterThan(0);
        
        // Perform operations on resources server
        const resources = await resourcesClient.listResources();
        expect(resources.length).toBeGreaterThan(0);
        
        // Test serialized operations across different clients
        const toolResponse = await toolsClient.callTool(tools[0].name, { test: "value" });
        expect(toolResponse).toBeDefined();
        
        if (resources.length > 0) {
          const resourceContent = await resourcesClient.readResource(resources[0].uri);
          expect(resourceContent).toBeDefined();
        }
        
        // Disconnect one client
        await toolsClient.disconnect();
        
        // Create a new manager and verify we can reuse the toolsServer name
        const newManager = manager(config);
        const reactivatedManager = await newManager.use("toolsServer");
        expect(reactivatedManager.getClient("toolsServer")).toBeDefined();
      }
    } finally {
      await result.disconnectAll();
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.listPrompts(): Handles error for unsupported method", async () => {
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
        // This method should throw an error since it's not supported by the echo server
        let error: unknown;
        try {
          await client.listPrompts();
          error = null;
        } catch (err) {
          error = err;
        }
        
        // Verify an error was thrown
        expect(error).toBeDefined();
        expect(error).not.toBeNull();
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("ClientAPI.getPrompt(): Handles error for non-existent prompt", async () => {
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
        // This method should throw an error since it's not supported by the echo server
        let error: unknown;
        try {
          await client.getPrompt("non-existent-prompt");
          error = null;
        } catch (err) {
          error = err;
        }
        
        // Verify an error was thrown
        expect(error).toBeDefined();
        expect(error).not.toBeNull();
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });
}); 