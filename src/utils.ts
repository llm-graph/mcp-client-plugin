import { JSONRPC_VERSION } from "./constants";
import { JsonRpcMessage, JsonRpcId, JsonRpcRequest, JsonRpcNotification, JsonRpcResponse } from "./types";

  
let idCounter = 0;

export function generateId(): number {
  return idCounter++;
}

export function safeJsonParse(text: string): JsonRpcMessage | undefined {
  try {
    const parsed = JSON.parse(text);
    // Basic validation to check if it looks like a JSON-RPC message
    if (typeof parsed === 'object' && parsed !== null && parsed.jsonrpc === JSONRPC_VERSION) {
      return parsed as JsonRpcMessage;
    }
    return undefined;
  } catch (e) {
    return undefined;
  }
}

export function createJsonRpcRequest(
  method: string,
  params?: unknown,
  id?: JsonRpcId
): JsonRpcRequest {
  return {
    jsonrpc: JSONRPC_VERSION,
    id: id ?? generateId(),
    method,
    params,
  };
}

export function createJsonRpcNotification(
    method: string,
    params?: unknown,
): Omit<JsonRpcNotification, 'jsonrpc'> { // Use Omit for internal consistency if needed
    return { method, params };
}


export function createJsonRpcErrorResponse(
    id: JsonRpcId,
    code: number,
    message: string,
    data?: unknown
): JsonRpcResponse {
    return {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: { code, message, data },
    };
}

export function createMcpError(message: string, code?: number, data?: unknown): Error {
    const customError = new Error(message);
    Object.defineProperties(customError, {
        code: { value: code, enumerable: true, writable: true },
        data: { value: data, enumerable: true, writable: true }
    });
    return customError;
}

export function promiseWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string
): Promise<T> {
  // New version doesn't need to return the timer
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(createMcpError(timeoutMessage, -32000));
    }, ms);
    
    promise
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export function processStdioBuffer(
    chunk: string,
    existingBuffer: string,
    onMessage: (message: JsonRpcMessage) => void,
    onError: (error: Error) => void
): string {
    let buffer = existingBuffer + chunk;
    let newlineIndex;

    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, newlineIndex);
        buffer = buffer.substring(newlineIndex + 1);

        if (line.trim().length > 0) {
            const message = safeJsonParse(line);
            if (message) {
                try {
                    onMessage(message);
                } catch (handlerError) {
                    onError(createMcpError(`Error processing message: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`));
                }
            } else {
                onError(createMcpError(`Received invalid JSON line: ${line.substring(0, 100)}...`));
            }
        }
    }
    return buffer; // Return the remaining part of the buffer
}