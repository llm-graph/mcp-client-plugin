#!/usr/bin/env bun

import { JSONRPC_VERSION } from "../../src/constants";

// Mock tools server for testing
// This server implements list_tools and call_tool methods

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

// Example tools for testing
const TOOLS = [
  {
    name: "test_tool",
    description: "A test tool for testing",
    inputSchema: {
      type: "object",
      properties: {
        test: { type: "string" }
      }
    }
  },
  {
    name: "calculator",
    description: "Simple calculator",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] }
      },
      required: ["a", "b", "operation"]
    }
  }
];

// Handle stdin input
const stdin = process.stdin;
const stdout = process.stdout;

const handleRequest = (request: JsonRpcRequest): void => {
  if (request.method === "initialize") {
    // Respond to initialize with capabilities
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        capabilities: {
          tools: {}
        }
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
  } else if (request.method === "initialized") {
    // No response needed for this notification
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
  } else if (request.method === "list_tools") {
    // Respond with list of tools
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        tools: TOOLS
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
  } else if (request.method === "call_tool") {
    // Handle tool calls
    const params = request.params as { name: string; params: Record<string, unknown> } | undefined;
    
    if (!params || typeof params !== "object") {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        error: {
          code: -32602,
          message: "Invalid params"
        }
      };
      stdout.write(JSON.stringify(errorResponse) + "\n");
      return;
    }
    
    const { name, params: toolParams } = params;
    
    // Check if the tool exists
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        error: {
          code: -32601,
          message: `Tool ${name} not found`
        }
      };
      stdout.write(JSON.stringify(errorResponse) + "\n");
      return;
    }
    
    // Handle specific tools
    if (name === "test_tool") {
      const response: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        result: {
          message: `Test tool called with params: ${JSON.stringify(toolParams)}`
        }
      };
      stdout.write(JSON.stringify(response) + "\n");
    } else if (name === "calculator") {
      const { a, b, operation } = toolParams as { a: number; b: number; operation: string };
      
      let result: number;
      switch (operation) {
        case "add":
          result = a + b;
          break;
        case "subtract":
          result = a - b;
          break;
        case "multiply":
          result = a * b;
          break;
        case "divide":
          if (b === 0) {
            const errorResponse: JsonRpcResponse = {
              jsonrpc: JSONRPC_VERSION,
              id: request.id,
              error: {
                code: -32603,
                message: "Division by zero"
              }
            };
            stdout.write(JSON.stringify(errorResponse) + "\n");
            return;
          }
          result = a / b;
          break;
        default:
          const errorResponse: JsonRpcResponse = {
            jsonrpc: JSONRPC_VERSION,
            id: request.id,
            error: {
              code: -32602,
              message: `Invalid operation: ${operation}`
            }
          };
          stdout.write(JSON.stringify(errorResponse) + "\n");
          return;
      }
      
      const response: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        result: {
          result
        }
      };
      stdout.write(JSON.stringify(response) + "\n");
    }
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
      }
    }
  }
});

// Handle process termination
process.on("SIGTERM", () => {
  process.exit(0);
});

process.on("SIGINT", () => {
  process.exit(0);
});

// Keep the process running
stdin.resume(); 