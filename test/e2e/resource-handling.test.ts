import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { manager } from "../../src/core";
import { createServerScriptFile, setupTestEnv, cleanupTestEnv } from "./e2e-util";
import { JSONRPC_VERSION } from "../../src/constants";
import type { ManagerConfig } from "../../src/types";

describe("E2E Resource Handling", () => {
  let tempDir: string;
  let serverScriptPath: string;
  const filesToCleanup: string[] = [];
  
  beforeAll(async () => {
    // Set up the test environment
    tempDir = await setupTestEnv();
    
    // Create a simple server script that responds to JSON-RPC requests
    const serverScript = `
    // Server script for resource handling tests
    
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    // Example resources for testing
    const RESOURCES = [
      {
        uri: "test:///sample.txt",
        name: "Sample Text File",
        description: "A sample text file for testing",
        mimeType: "text/plain"
      },
      {
        uri: "test:///sample.json",
        name: "Sample JSON File",
        description: "A sample JSON file for testing",
        mimeType: "application/json"
      }
    ];
    
    // Mock content for resources
    const RESOURCE_CONTENT = new Map([
      ["test:///sample.txt", "This is a sample text file for testing purposes."],
      ["test:///sample.json", JSON.stringify({ name: "Sample", value: 42 })]
    ]);
    
    // Handle stdin input
    let buffer = "";
    stdin.on("data", (chunk) => {
      const data = chunk.toString();
      buffer += data;
      
      // Process complete lines
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\\n")) !== -1) {
        const line = buffer.substring(0, newlineIndex);
        buffer = buffer.substring(newlineIndex + 1);
        
        if (line.trim()) {
          try {
            const request = JSON.parse(line);
            
            if (request.method === "initialize") {
              // Respond to initialize with capabilities
              const response = {
                jsonrpc: "${JSONRPC_VERSION}",
                id: request.id,
                result: {
                  capabilities: {
                    resources: {}
                  }
                }
              };
              stdout.write(JSON.stringify(response) + "\\n");
            } else if (request.method === "initialized") {
              // No response needed for this notification
            } else if (request.method === "list_resources") {
              // Respond with list of resources
              const response = {
                jsonrpc: "${JSONRPC_VERSION}",
                id: request.id,
                result: {
                  resources: RESOURCES
                }
              };
              stdout.write(JSON.stringify(response) + "\\n");
            } else if (request.method === "read_resource") {
              // Handle resource reading
              const params = request.params;
              
              if (params && RESOURCE_CONTENT.has(params.uri)) {
                const content = RESOURCE_CONTENT.get(params.uri);
                const response = {
                  jsonrpc: "${JSONRPC_VERSION}",
                  id: request.id,
                  result: {
                    content
                  }
                };
                stdout.write(JSON.stringify(response) + "\\n");
              } else {
                const errorResponse = {
                  jsonrpc: "${JSONRPC_VERSION}",
                  id: request.id,
                  error: {
                    code: -32602,
                    message: \`Resource not found: \${params?.uri || 'unknown'}\`
                  }
                };
                stdout.write(JSON.stringify(errorResponse) + "\\n");
              }
            } else if (request.method === "ping") {
              // Respond to ping
              const response = {
                jsonrpc: "${JSONRPC_VERSION}",
                id: request.id,
                result: {
                  pong: true
                }
              };
              stdout.write(JSON.stringify(response) + "\\n");
            } else {
              // Respond with method not found error
              const response = {
                jsonrpc: "${JSONRPC_VERSION}",
                id: request.id,
                error: {
                  code: -32601,
                  message: \`Method \${request.method} not found\`
                }
              };
              stdout.write(JSON.stringify(response) + "\\n");
            }
          } catch (error) {
            stdout.write(JSON.stringify({
              jsonrpc: "${JSONRPC_VERSION}",
              id: "unknown",
              error: {
                code: -32700,
                message: "Parse error",
                data: String(error)
              }
            }) + "\\n");
          }
        }
      }
    });
    
    // Handle process termination
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
    
    // Keep the process running
    stdin.resume();
    `;
    
    serverScriptPath = await createServerScriptFile(tempDir, serverScript);
    filesToCleanup.push(serverScriptPath);
  });
  
  afterAll(async () => {
    // Clean up after all tests
    await cleanupTestEnv(filesToCleanup);
  });
  
  test("Successfully lists and reads resources", async () => {
    const config: ManagerConfig = {
      resourceServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [serverScriptPath],
        },
      },
    };
    
    const mcpManager = manager(config);
    
    try {
      // Connect to the server
      const connectedManager = await mcpManager.use("resourceServer");
      
      // Get the client
      const client = connectedManager.getClient("resourceServer");
      expect(client).toBeDefined();
      
      if (client) {
        // Add a slight delay to ensure server is fully initialized
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // List available resources
        const resources = await client.listResources();
        expect(resources).toBeInstanceOf(Array);
        expect(resources.length).toBe(2);
        expect(resources[0].uri).toBe("test:///sample.txt");
        expect(resources[1].uri).toBe("test:///sample.json");
        
        // Read the text resource
        const textContent = await client.readResource("test:///sample.txt");
        expect(typeof textContent).toBe("string");
        expect(textContent).toBe("This is a sample text file for testing purposes.");
        
        // Read the JSON resource
        const jsonContent = await client.readResource("test:///sample.json");
        expect(typeof jsonContent).toBe("string");
        const parsedJson = JSON.parse(jsonContent as string);
        expect(parsedJson.name).toBe("Sample");
        expect(parsedJson.value).toBe(42);
        
        // Try reading a non-existent resource
        try {
          await client.readResource("test:///non-existent.txt");
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    } finally {
      // Clean up by disconnecting all clients
      await mcpManager.disconnectAll();
    }
  }, 15000);
}); 