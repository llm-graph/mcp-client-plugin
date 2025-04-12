#!/usr/bin/env bun

import { JSONRPC_VERSION } from "../../src/constants";

// Basic JSON-RPC echo server for testing
// This server accepts initialize and ping requests and responds to them

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
          tools: {},
          resources: {},
          prompts: {}
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