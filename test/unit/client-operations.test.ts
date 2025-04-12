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
}); 