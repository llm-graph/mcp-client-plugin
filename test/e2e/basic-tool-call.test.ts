import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

const TIMEOUT = 10000; // Increase timeout to 10 seconds

describe("E2E Simple Echo Test", () => {
  // Test a much simpler approach - use one of our existing helper files
  test("Use the pre-built echo-server.ts helper", async () => {
    // Import only what we need for the test
    const echoServerPath = Bun.fileURLToPath(new URL("../helpers/echo-server.ts", import.meta.url));
    
    console.log("Using echo server at:", echoServerPath);
    
    const config: ManagerConfig = {
      echoServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [echoServerPath],
          // Add extra debug info to the environment
          env: {
            DEBUG: "true"
          }
        },
      },
    };
    
    const mcpManager = manager(config);
    
    try {
      console.log("Connecting to echo server...");
      // Connect to the server with increased timeout
      const connectedManager = await mcpManager.use("echoServer");
      
      console.log("Connected successfully, getting client...");
      // Get the client
      const client = connectedManager.getClient("echoServer");
      expect(client).toBeDefined();
      
      if (client) {
        console.log("Sending ping...");
        // Test ping
        await client.ping();
        console.log("Ping successful!");
      }
      
      // Test passes if we reach this point
      expect(true).toBe(true);
    } catch (error) {
      console.error("Test error:", error);
      throw error;
    } finally {
      console.log("Disconnecting...");
      // Clean up
      await mcpManager.disconnectAll();
      console.log("Disconnected successfully");
    }
  }, TIMEOUT);
}); 




