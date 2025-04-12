#!/usr/bin/env bun

import { JSONRPC_VERSION } from "../../src/constants";

// Mock resources server for testing
// This server implements list_resources and read_resource methods

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
  },
  {
    uri: "test:///sample.bin",
    name: "Sample Binary File",
    description: "A sample binary file for testing",
    mimeType: "application/octet-stream"
  }
];

// Mock content for resources
const RESOURCE_CONTENT = new Map<string, string>([
  ["test:///sample.txt", "This is a sample text file for testing purposes."],
  ["test:///sample.json", JSON.stringify({ name: "Sample", value: 42, nested: { a: 1, b: 2 } }, null, 2)],
  ["test:///sample.bin", Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]).toString("base64")]
]);

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
          resources: {}
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
  } else if (request.method === "list_resources") {
    // Respond with list of resources
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        resources: RESOURCES
      }
    };
    stdout.write(JSON.stringify(response) + "\n");
  } else if (request.method === "read_resource") {
    // Handle resource reading
    const params = request.params as { uri: string } | undefined;
    
    if (!params || typeof params !== "object" || !params.uri) {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        error: {
          code: -32602,
          message: "Invalid params - uri is required"
        }
      };
      stdout.write(JSON.stringify(errorResponse) + "\n");
      return;
    }
    
    const { uri } = params;
    
    // Check if the resource exists
    if (!RESOURCE_CONTENT.has(uri)) {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: JSONRPC_VERSION,
        id: request.id,
        error: {
          code: -32602, 
          message: `Resource not found: ${uri}`
        }
      };
      stdout.write(JSON.stringify(errorResponse) + "\n");
      return;
    }
    
    // Get the resource content
    const content = RESOURCE_CONTENT.get(uri);
    
    // For binary data, we'd use base64 encoding
    const isBinary = uri === "test:///sample.bin";
    
    const response: JsonRpcResponse = {
      jsonrpc: JSONRPC_VERSION,
      id: request.id,
      result: {
        content,
        encoding: isBinary ? "base64" : "utf8"
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