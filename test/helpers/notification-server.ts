#!/usr/bin/env bun

import { JSONRPC_VERSION } from "../../src/constants";

// Mock notification server for testing
// This server sends notifications on initialization and in response to other requests

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcNotification {
  jsonrpc: string;
  method: string;
  params?: unknown;
}

// Get the server name from command line arguments, if provided
const args = process.argv.slice(2);
const serverNameArg = args.find(arg => arg.startsWith("--server-name="));
const SERVER_NAME = serverNameArg ? serverNameArg.substring("--server-name=".length) : "notification-server";

// Handle stdin input
const stdin = process.stdin;
const stdout = process.stdout;

// Send a notification
const sendNotification = (method: string, params?: unknown): void => {
  const notification: JsonRpcNotification = {
    jsonrpc: JSONRPC_VERSION,
    method,
    params
  };
  stdout.write(JSON.stringify(notification) + "\n");
};

// Process initialization

const handleRequest = (request: JsonRpcRequest): void => {
  if (request.method === "initialize") {
    // Respond to initialize with capabilities
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        capabilities: {
          // No specific capabilities, just basic functionality
        }
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
    
    // Send an initial notification after initialization
    setTimeout(() => {
      sendNotification("$/serverStarted", {
        serverName: SERVER_NAME,
        timestamp: new Date().toISOString()
      });
    }, 50);
    
  } else if (request.method === "initialized") {
    // No response needed for this notification
    
    // Send a notification that the initialization is complete
    sendNotification("$/initialized", {
      serverName: SERVER_NAME,
      timestamp: new Date().toISOString()
    });
  } else if (request.method === "ping") {
    // Respond to ping
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        pong: true
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
    
    // Send a notification in response to the ping
    sendNotification("$/ping", {
      serverName: SERVER_NAME,
      received: new Date().toISOString(),
      message: "Ping received"
    });
    
    // Send a progress notification
    sendNotification("$/progress", {
      serverName: SERVER_NAME,
      operation: "test",
      progress: Math.random() * 100, // Random progress value
      status: "running"
    });
  } else {
    // Respond with method not found error
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      error: {
        code: -32601,
        message: `Method ${request.method} not found`
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
    
    // Send a notification about the error
    sendNotification("$/error", {
      serverName: SERVER_NAME,
      method: request.method,
      message: `Method ${request.method} not found`,
      timestamp: new Date().toISOString()
    });
  }
};

// Read line by line from stdin
let buffer = "";
stdin.on("data", (chunk: Buffer) => {
  const data = chunk.toString();
  buffer += data;
  
  // Process complete lines
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.substring(0, newlineIndex);
    buffer = buffer.substring(newlineIndex + 1);
    
    if (line.trim()) {
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        handleRequest(request);
      } catch (error) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: JSONRPC_VERSION,
          id: "unknown",
          error: {
            code: -32700,
            message: "Parse error",
            data: String(error)
          }
        };
        stdout.write(JSON.stringify(errorResponse) + "\n");
        
        // Send a notification about the parse error
        sendNotification("$/parseError", {
          serverName: SERVER_NAME,
          message: "Failed to parse JSON-RPC request",
          data: line.substring(0, 100), // Send a portion of the problematic line
          timestamp: new Date().toISOString()
        });
      }
    }
  }
});

// Handle process termination
process.on("SIGTERM", () => {
  // Send a notification that we're shutting down
  sendNotification("$/shutdown", {
    serverName: SERVER_NAME,
    timestamp: new Date().toISOString()
  });
  
  setTimeout(() => {
    process.exit(0);
  }, 50); // Give a small delay for the notification to be sent
});

process.on("SIGINT", () => {
  // Send a notification that we're shutting down
  sendNotification("$/shutdown", {
    serverName: SERVER_NAME,
    timestamp: new Date().toISOString()
  });
  
  setTimeout(() => {
    process.exit(0);
  }, 50); // Give a small delay for the notification to be sent
});

// Keep the process running
stdin.resume(); 