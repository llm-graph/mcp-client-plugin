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
    // Set up test environment with longer timeouts
    const TIMEOUT_MS = 10000;
    
    const config: ManagerConfig = {
      resourceServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [serverScriptPath],
        },
      },
    };
    
    // Create the manager with explicit timeout
    const mcpManager = manager(config, {
      requestTimeoutMs: TIMEOUT_MS
    });
    
    try {
      // Connect to the server
      console.log("Connecting to resource server...");
      await mcpManager.use("resourceServer");
      
      // Get the client
      console.log("Getting resource client...");
      const client = mcpManager.getClient("resourceServer");
      console.log("Client found:", client ? "yes" : "no");
      
      if (!client) {
        throw new Error("Failed to get client");
      }
      
      // Wait for initialization
      console.log("Waiting for initialization...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log("Testing ping...");
      await client.ping();
      console.log("Ping successful");
      
      // List resources
      console.log("Listing resources...");
      const resources = await client.listResources();
      console.log(`Found ${resources.length} resources`);
      
      expect(resources).toBeInstanceOf(Array);
      expect(resources.length).toBe(2);
      expect(resources[0].uri).toBe("test:///sample.txt");
      expect(resources[1].uri).toBe("test:///sample.json");
      
      // Read resources
      console.log("Reading text resource...");
      const textContent = await client.readResource("test:///sample.txt");
      expect(typeof textContent).toBe("string");
      expect(textContent).toBe("This is a sample text file for testing purposes.");
      
      console.log("Reading JSON resource...");
      const jsonContent = await client.readResource("test:///sample.json");
      expect(typeof jsonContent).toBe("string");
      
      const parsedJson = JSON.parse(jsonContent as string);
      expect(parsedJson.name).toBe("Sample");
      expect(parsedJson.value).toBe(42);
      
      // Test error handling
      console.log("Testing error handling...");
      try {
        await client.readResource("test:///non-existent.txt");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    } finally {
      // Clean up
      console.log("Disconnecting...");
      await mcpManager.disconnectAll();
    }
  }, 30000); // Increase the test timeout
}); 