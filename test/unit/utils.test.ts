import { describe, expect, test } from "bun:test";
import { 
  safeJsonParse, 
  createJsonRpcRequest, 
  createJsonRpcNotification, 
  createJsonRpcErrorResponse, 
  createMcpError, 
  promiseWithTimeout, 
  processStdioBuffer 
} from "../../src/utils";
import { JSONRPC_VERSION } from "../../src/constants";
import type { JsonRpcMessage } from "../../src/types";

describe("safeJsonParse", () => {
  test("returns undefined for invalid JSON", () => {
    expect(safeJsonParse("invalid json")).toBeUndefined();
  });

  test("returns undefined for non-object values", () => {
    expect(safeJsonParse("123")).toBeUndefined();
    expect(safeJsonParse("true")).toBeUndefined();
    expect(safeJsonParse("\"string\"")).toBeUndefined();
  });

  test("returns undefined for objects without proper jsonrpc version", () => {
    expect(safeJsonParse('{"foo": "bar"}')).toBeUndefined();
    expect(safeJsonParse('{"jsonrpc": "1.0"}')).toBeUndefined();
  });

  test("returns parsed object for valid JSON-RPC messages", () => {
    const validRequest = {
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      method: "test",
      params: { foo: "bar" },
    };
    expect(safeJsonParse(JSON.stringify(validRequest))).toEqual(validRequest);
  });
});

describe("createJsonRpcRequest", () => {
  test("creates a request with default id if not provided", () => {
    const request = createJsonRpcRequest("test");
    expect(request.jsonrpc).toBe(JSONRPC_VERSION);
    expect(request.method).toBe("test");
    expect(request.id).toBeNumber();
    expect(request.params).toBeUndefined();
  });

  test("creates a request with provided parameters", () => {
    const params = { foo: "bar" };
    const request = createJsonRpcRequest("test", params, 42);
    expect(request).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 42,
      method: "test",
      params,
    });
  });
});

describe("createJsonRpcNotification", () => {
  test("creates a notification without params", () => {
    const notification = createJsonRpcNotification("test");
    expect(notification.method).toBe("test");
    expect(notification.params).toBeUndefined();
  });

  test("creates a notification with params", () => {
    const params = { foo: "bar" };
    const notification = createJsonRpcNotification("test", params);
    expect(notification).toEqual({
      method: "test",
      params,
    });
  });
});

describe("createJsonRpcErrorResponse", () => {
  test("creates an error response without data", () => {
    const response = createJsonRpcErrorResponse(1, 123, "Test error");
    expect(response).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      error: {
        code: 123,
        message: "Test error",
      },
    });
  });

  test("creates an error response with data", () => {
    const data = { foo: "bar" };
    const response = createJsonRpcErrorResponse(1, 123, "Test error", data);
    expect(response).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      error: {
        code: 123,
        message: "Test error",
        data,
      },
    });
  });
});

describe("createMcpError", () => {
  test("creates an Error with message", () => {
    const error = createMcpError("Test error");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Test error");
    expect((error as Error & { code?: number }).code).toBeUndefined();
    expect((error as Error & { data?: unknown }).data).toBeUndefined();
  });

  test("creates an Error with code and data", () => {
    const data = { foo: "bar" };
    const error = createMcpError("Test error", 123, data);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Test error");
    expect((error as Error & { code?: number }).code).toBe(123);
    expect((error as Error & { data?: unknown }).data).toBe(data);
  });
});

describe("promiseWithTimeout", () => {
  test("resolves with the original promise result if it completes before timeout", async () => {
    const promise = Promise.resolve("success");
    const result = await promiseWithTimeout(promise, 1000, "Timeout");
    expect(result).toBe("success");
  });

  test("rejects with timeout error if the promise doesn't complete in time", async () => {
    const neverResolve = new Promise(() => {});
    
    try {
      await promiseWithTimeout(neverResolve, 10, "Timeout Message");
      expect("should not reach here").toBe("false");
    } catch (error) {
      const mcpError = error as Error & { code?: number };
      expect(mcpError).toBeInstanceOf(Error);
      expect(mcpError.message).toBe("Timeout Message");
      expect(mcpError.code).toBe(-32000);
    }
  });
});

describe("processStdioBuffer", () => {
  test("processes complete lines and returns remaining buffer", () => {
    const onMessage = (message: JsonRpcMessage) => {
      expect(message).toEqual({ jsonrpc: JSONRPC_VERSION, method: "test" });
    };
    const onError = () => {
      expect(true).toBe(false); // Should not be called
    };
    
    const input = '{"jsonrpc":"2.0","method":"test"}\nincomplete';
    const result = processStdioBuffer(input, "", onMessage, onError);
    
    expect(result).toBe("incomplete");
  });

  test("handles invalid JSON lines", () => {
    const onMessage = () => {
      expect(true).toBe(false); // Should not be called
    };
    let errorCalled = false;
    const onError = () => {
      errorCalled = true;
    };
    
    const input = 'invalid json\n';
    const result = processStdioBuffer(input, "", onMessage, onError);
    
    expect(result).toBe("");
    expect(errorCalled).toBe(true);
  });

  test("handles multiple complete lines", () => {
    const messages: JsonRpcMessage[] = [];
    const onMessage = (message: JsonRpcMessage) => {
      messages.push(message);
    };
    const onError = () => {
      expect(true).toBe(false); // Should not be called
    };
    
    const input = '{"jsonrpc":"2.0","method":"test1"}\n{"jsonrpc":"2.0","method":"test2"}\n';
    const result = processStdioBuffer(input, "", onMessage, onError);
    
    expect(result).toBe("");
    expect(messages).toHaveLength(2);
    expect((messages[0] as any).method).toBe("test1");
    expect((messages[1] as any).method).toBe("test2");
  });

  test("appends to existing buffer", () => {
    const onMessage = (message: JsonRpcMessage) => {
      expect(message).toEqual({ jsonrpc: JSONRPC_VERSION, method: "test" });
    };
    const onError = () => {
      expect(true).toBe(false); // Should not be called
    };
    
    const existingBuffer = '{"jsonrpc":"2.0",';
    const input = '"method":"test"}\n';
    const result = processStdioBuffer(input, existingBuffer, onMessage, onError);
    
    expect(result).toBe("");
  });
}); 