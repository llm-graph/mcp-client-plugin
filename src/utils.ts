import { JSONRPC_VERSION, DEFAULT_REQUEST_TIMEOUT_MS, PROCESS_TERMINATION_TIMEOUT_MS, API_METHODS } from "./constants";
import { JsonRpcMessage, JsonRpcId, JsonRpcRequest, JsonRpcNotification, JsonRpcResponse, ManagerStateType, TransportConfig, StdioTransportConfig, SseTransportConfig, Transport, PendingRequests, NotificationHandler, ClientState, Tool, Resource, Prompt, ClientAPI } from "./types";
import { EventSourceCompatible, ReaderCompatible } from "./bun-types";

  
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

export function createMcpError(message: string, code?: number, data?: unknown): Error & { code?: number, data?: unknown } {
    const customError = new Error(message) as Error & { code?: number, data?: unknown };
    customError.code = code;
    customError.data = data;
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

// Logging utilities
export const log = (level: number, message: string, data?: unknown): void => {
  const currentLevel = process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : 1;
  if (level <= currentLevel) {
    console.log(`[MCP] ${message}`, data ? data : '');
  }
};

export const logError = (level: number, message: string, error?: unknown): void => {
  const currentLevel = process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) : 1;
  if (level <= currentLevel) {
    console.error(`[MCP] ${message}`, error ? error : '');
  }
};

// Log levels
export const LOG_LEVELS = {
  ERROR: 1,   // Critical errors
  WARN: 2,    // Warnings and important operational messages
  INFO: 3,    // General information about operations
  DEBUG: 4,   // Detailed debugging information
  TRACE: 5    // Very detailed tracing information
};

// Added functions to handle client registry operations
export type ManagerRegistryEntry = {
  id: number;
  updateState: (state: ManagerStateType) => void;
  state: ManagerStateType;
};

export function findClientInOtherManager(
  serverName: string, 
  registry: Map<string, ManagerRegistryEntry[]>
): { found: boolean; manager?: ManagerRegistryEntry } {
  const managers = registry.get(serverName);
  if (!managers || managers.length === 0) {
    return { found: false };
  }
  
  // Try to find a manager that has this client
  for (const mgr of managers) {
    if (mgr.state.activeClients[serverName]) {
      return { found: true, manager: mgr };
    }
  }
  
  return { found: false };
}

export function copyActiveClients<T>(source: Record<string, T>): Record<string, T> {
  const newActiveClients: Record<string, T> = {};
  Object.keys(source).forEach(clientName => {
    newActiveClients[clientName] = source[clientName];
  });
  return newActiveClients;
}

export type ClientStateInternals = {
  intentionalDisconnect: boolean;
  setIntentionalDisconnect: (value: boolean) => void;
};

export const createTransport = async (
  serverName: string,
  config: TransportConfig,
  messageHandler: (message: JsonRpcMessage) => void,
  errorHandler: (error: Error) => void,
  exitHandler?: (code: number | null) => void
): Promise<Transport> => {
  if (config.type === 'stdio') {
    const stdioCfg = config as StdioTransportConfig;
    
    // Wrap the Bun.spawn call in a try-catch
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn({
        cmd: [stdioCfg.command, ...(stdioCfg.args ?? [])],
        env: stdioCfg.env, cwd: stdioCfg.cwd,
        stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
      });
    } catch (err: unknown) {
      throw createMcpError(`Failed to spawn subprocess for ${serverName}: ${String(err)}`);
    }

    if (!proc.stdout || !proc.stdin || !proc.stderr) 
      throw createMcpError(`Failed to get stdio streams for ${serverName}`);

    // Create readers for streams - use as ReaderCompatible for type compatibility
    const stdoutReader = (proc.stdout as ReadableStream<Uint8Array>).getReader() as ReaderCompatible<Uint8Array>;
    const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader() as ReaderCompatible<Uint8Array>;

    // Process streams - update the type signature
    const processStream = async (reader: ReaderCompatible<Uint8Array>, processor: (t: string, b: string) => string, 
      buffer = '', errorMsg: string, errFn = errorHandler) => {
      try {
        let buf = buffer;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf = processor(new TextDecoder().decode(value), buf);
        }
      } catch (err) { 
        // Ignore errors during shutdown
        if (!proc.killed) {
          errFn(createMcpError(`${errorMsg}: ${String(err)}`)); 
        }
      }
    };

    // Handle stdout and stderr
    processStream(
      stdoutReader,
      (text, buffer) => processStdioBuffer(text, buffer, messageHandler, errorHandler),
      '',
      `Error reading stdout from ${serverName}`
    ).catch(err => {
      // Ignore errors during shutdown
      if (!proc.killed) {
        errorHandler(createMcpError(`Fatal stdout reader error: ${String(err)}`));
      }
    });

    processStream(
      stderrReader,
      (text, buffer) => {
        const lines = (buffer + text).split('\n');
        lines.slice(0, -1).forEach(line => { 
          if (line.trim()) logError(LOG_LEVELS.INFO, `${serverName} stderr: ${line.trim()}`);
        });
        return lines[lines.length - 1];
      },
      '',
      `Error reading stderr from ${serverName}`,
      err => {
        // Ignore errors during shutdown
        if (!proc.killed) {
          logError(LOG_LEVELS.ERROR, `${String(err)}`);
        }
      }
    ).catch(err => {
      // Ignore errors during shutdown
      if (!proc.killed) {
        logError(LOG_LEVELS.ERROR, `Fatal stderr reader error: ${String(err)}`);
      }
    });

    // Process exit handling
    proc.exited.then(exitHandler || (() => {}))
      .catch(err => {
        // Ignore errors during shutdown
        if (!proc.killed) {
          errorHandler(createMcpError(`Process exit handler error: ${String(err)}`));
        }
      });

    // Transport interface
    const cleanup = async () => {
      if (proc.killed) return; // Already cleaned up
      
      try {
        // Cancel and close all streams
        try { await stdoutReader.cancel(); } catch {}
        try { await stderrReader.cancel(); } catch {}
        try { await (proc.stdin as Bun.FileSink).end(); } catch {}
        
        // Kill the process if it's still running
        if (proc.pid && !proc.killed) {
          proc.kill();
          
          // Wait for process to exit or timeout
          const timeoutPromise = new Promise<void>(resolve => {
            setTimeout(() => resolve(), PROCESS_TERMINATION_TIMEOUT_MS);
          });
          
          await Promise.race([
            proc.exited.then(() => {}),
            timeoutPromise
          ]);
        }
      } catch (err) {
        logError(LOG_LEVELS.ERROR, `Error closing stdio transport: ${String(err)}`);
      }
    };

    // Create the transport for stdio with additional isClosed method
    let closed = false;
    
    // Transport interface
    return {
      send: async (message: JsonRpcRequest | JsonRpcNotification) => {
        try {
          if (proc.killed) {
            throw createMcpError(`Cannot send to ${serverName}: Process is no longer running`);
          }
          await (proc.stdin as Bun.FileSink).write(new TextEncoder().encode(JSON.stringify(message) + '\n'));
        } catch (err) {
          // Format and log the error
          const errorMessage = `Failed to write to stdin: ${String(err)}`;
          
          // Special handling for broken pipe errors
          const isPipeError = err && typeof err === 'object' && 'code' in err && 
                             ((err as any).code === 'EPIPE' || String(err).includes('pipe'));
          
          if (isPipeError) {
            log(LOG_LEVELS.INFO, `Process ${serverName} pipe closed, handling gracefully`);
          } else {
            // Only report non-pipe errors
            errorHandler(createMcpError(errorMessage));
          }
          
          await cleanup();
          
          throw createMcpError(errorMessage);
        }
      },
      close: async () => {
        closed = true;
        return cleanup();
      },
      isClosed: () => proc.killed || closed,
      _details: { type: 'stdio', process: proc }
    };
  } else { // SSE transport
    const sseCfg = config as SseTransportConfig;
    const abortController = new AbortController();
    
    // Update EventSource type
    let eventSource: EventSourceCompatible | null = null;
    let connected = false;
    let connectPromise: Promise<void> | null = null;
    
    // Define the timeout constant only where it's used
    const SSE_CONNECTION_TIMEOUT_MS = 10000;
    
    const connect = (): Promise<void> => {
      if (connectPromise) return connectPromise;
      
      connectPromise = new Promise<void>((resolve, reject) => {
        try {
          // Cast to any to avoid type checking during instantiation
          eventSource = new (globalThis as any).EventSource(sseCfg.url) as EventSourceCompatible;
          
          promiseWithTimeout(
            new Promise<void>((connectionResolve) => {
              // Choose between addEventListener and onopen depending on which exists
              if (eventSource!.addEventListener) {
                eventSource!.addEventListener('open', () => { 
                  connected = true; 
                  connectionResolve();
                  resolve(); 
                });
              } else if (eventSource!.onopen !== undefined) {
                eventSource!.onopen = () => { 
                  connected = true; 
                  connectionResolve();
                  resolve(); 
                };
              }
            }),
            SSE_CONNECTION_TIMEOUT_MS,
            `SSE connection timeout for ${serverName}`
          ).catch(err => {
            if (eventSource) { 
              if (typeof eventSource.close === 'function') {
                eventSource.close();
              }
              eventSource = null; 
            }
            connectPromise = null;
            reject(err);
          });
          
          // Handle message events
          if (eventSource.addEventListener) {
            eventSource.addEventListener('message', (event: Event) => {
              try {
                // Type cast to MessageEvent
                const messageEvent = event as MessageEvent;
                const data = messageEvent.data as string;
                const message = safeJsonParse(data);
                message 
                  ? messageHandler(message) 
                  : errorHandler(createMcpError(`Invalid JSON via SSE: ${data.substring(0, 100)}...`));
              } catch (err) {
                errorHandler(createMcpError(`SSE message error: ${String(err)}`));
              }
            });
          } else if (eventSource.onmessage !== undefined) {
            eventSource.onmessage = (event: any) => {
              try {
                const data = event.data as string;
                const message = safeJsonParse(data);
                message 
                  ? messageHandler(message) 
                  : errorHandler(createMcpError(`Invalid JSON via SSE: ${data.substring(0, 100)}...`));
              } catch (err) {
                errorHandler(createMcpError(`SSE message error: ${String(err)}`));
              }
            };
          }
  
          // Handle error events
          if (eventSource.addEventListener) {
            eventSource.addEventListener('error', () => {
              if (!connected) {
                reject(createMcpError(`SSE connection error for ${serverName}`));
                connectPromise = null;
              } else {
                errorHandler(createMcpError(`SSE error for ${serverName}`));
              }
            });
          } else if (eventSource.onerror !== undefined) {
            eventSource.onerror = () => {
              if (!connected) {
                reject(createMcpError(`SSE connection error for ${serverName}`));
                connectPromise = null;
              } else {
                errorHandler(createMcpError(`SSE error for ${serverName}`));
              }
            };
          }
          
        } catch (err) {
          reject(createMcpError(`SSE connection failed: ${String(err)}`));
          connectPromise = null;
        }
      });
      
      return connectPromise;
    };

    // Initial connection attempt
    connect().catch(err => errorHandler(createMcpError(`Initial SSE connection failed: ${String(err)}`)));

    // Transport interface
    return {
      send: async (message: JsonRpcRequest | JsonRpcNotification) => {
        if (!connected) await connect();
        try {
          await fetch(sseCfg.url, {
            method: 'POST',
            headers: {
              ...sseCfg.headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
            signal: abortController.signal,
          });
        } catch (err) {
          const errorMessage = `Error sending message to ${serverName} via HTTP: ${String(err)}`;
          if (abortController.signal.aborted) {
            // Expected abort, handle gracefully
            log(LOG_LEVELS.INFO, `Request to ${serverName} was aborted (expected)`);
          } else {
            errorHandler(createMcpError(errorMessage));
            
            // Try to reconnect once on error
            try {
              log(LOG_LEVELS.INFO, `Attempting to reconnect to ${serverName}...`);
              await connect();
            } catch (reconnectError) {
              log(LOG_LEVELS.ERROR, `Failed to reconnect to ${serverName}: ${String(reconnectError)}`);
            }
          }
          throw createMcpError(errorMessage);
        }
      },
      close: async () => {
        abortController.abort('Client closing connection');
        if (eventSource) { 
          if (typeof eventSource.close === 'function') {
            eventSource.close();
          }
          eventSource = null;
        }
        connected = false;
        connectPromise = null;
      },
      isClosed: () => !connected,
      _details: { type: 'sse', sseSource: eventSource || undefined, abortController }
    };
  }
};

export const handleMessage = (message: JsonRpcMessage, serverName: string, pendingRequests: PendingRequests, 
  onNotification: NotificationHandler): void => {
  // Pass notifications to the notification handler
  if ('method' in message && !('id' in message)) {
    const notification = {
      method: message.method,
      params: message.params,
    };
    onNotification(serverName, notification);
    return;
  }
  
  // Handle response messages with matching request ID
  if ('id' in message) {
    const resolver = pendingRequests.get(message.id);
    if (resolver) {
      // Clean up the timeout timer
      if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
      
      // Remove from pending requests
      pendingRequests.delete(message.id);
      
      // Handle error responses
      if ('error' in message && message.error) {
        resolver.reject(createMcpError(
          message.error.message, 
          message.error.code,
          message.error.data
        ));
        return;
      }
      
      // Resolve with the result
      resolver.resolve('result' in message ? message.result : undefined);
    }
  }
};

export const createClientApi = (
  serverName: string, 
  transport: Transport, 
  pendingRequests: PendingRequests,
  capabilities?: Readonly<Record<string, unknown>>,
  state?: ManagerStateType
): [ClientAPI, ClientStateInternals] => {
  let intentionalDisconnect = false;
  const setIntentionalDisconnect = (value: boolean) => { intentionalDisconnect = value; };
  
  // Create request function
  const sendRequest = <TResult = unknown>(method: string, params?: unknown): Promise<TResult> => {
    // Simple check: do we have a valid transport?
    if (!transport || transport.isClosed()) {
      return Promise.reject(createMcpError(`Cannot send request to ${serverName}: transport is closed`));
    }
    
    // Create request with unique ID
    const id = generateId();
    const request = createJsonRpcRequest(method, params, id);
    
    // Set up the request promise
    const requestPromise = new Promise<TResult>((resolve, reject) => {
      let timeoutTimer: number | NodeJS.Timeout | null = null;
      
      const requestTimeoutMs = state?.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      if (requestTimeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(createMcpError(`Request "${method}" timed out after ${requestTimeoutMs}ms`));
        }, requestTimeoutMs);
      }
      
      pendingRequests.set(id, { 
        resolve: resolve as (value: unknown) => void, 
        reject, 
        timeoutTimer 
      });
    });
    
    // Send the request and handle transport errors
    transport.send(request).catch(err => {
      pendingRequests.delete(id);
      return Promise.reject(err);
    });
    
    return requestPromise;
  };
  
  // Create and freeze the client API
  const clientApi = Object.freeze({
    getCapabilities: () => capabilities,
    callTool: <TResult = unknown>(name: string, params: Record<string, unknown>) => 
      sendRequest<TResult>(API_METHODS.CALL_TOOL, { name, params }),
    listTools: () => 
      sendRequest<{ tools: ReadonlyArray<Tool> }>(API_METHODS.LIST_TOOLS, undefined).then(res => res.tools ?? []),
    readResource: (uri: string) => 
      sendRequest<{ content: string | Buffer }>(API_METHODS.READ_RESOURCE, { uri }).then(res => res.content),
    listResources: () => 
      sendRequest<{ resources: ReadonlyArray<Resource> }>(API_METHODS.LIST_RESOURCES, undefined).then(res => res.resources ?? []),
    listPrompts: () => 
      sendRequest<{ prompts: ReadonlyArray<Prompt> }>(API_METHODS.LIST_PROMPTS, undefined).then(res => res.prompts ?? []),
    getPrompt: (name: string, args?: Record<string, unknown>) => 
      sendRequest<{ prompt: string }>(API_METHODS.GET_PROMPT, { name, args }).then(res => res.prompt),
    ping: async () => { 
      const id = generateId();
      const request = createJsonRpcRequest(API_METHODS.PING, undefined, id);
      
      return new Promise<void>((resolve, reject) => {
        const timeoutMs = state?.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        let timeoutTimer: number | NodeJS.Timeout | null = null;
        
        if (timeoutMs > 0) {
          timeoutTimer = setTimeout(() => {
            pendingRequests.delete(id);
            reject(createMcpError(`Ping request timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }
        
        pendingRequests.set(id, {
          resolve: () => resolve(),
          reject,
          timeoutTimer
        });
        
        transport.send(request).catch(err => {
          pendingRequests.delete(id);
          reject(err);
        });
      });
    },
    disconnect: async () => {}, // Stub, will be implemented in core.ts
  });
  
  return [
    clientApi,
    { intentionalDisconnect, setIntentionalDisconnect }
  ];
};

export const disconnectClient = async (
  serverName: string,
  clientState: ClientState | undefined,
  globalRegistry: Map<string, ManagerRegistryEntry[]>
): Promise<void> => {
  if (!clientState) return;
  
  try {
    // Close the transport
    await clientState.transport.close();
    
    // Clean up pending requests
    clientState.pendingRequests.forEach(resolver => {
      if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
      resolver.reject(createMcpError(`Client ${serverName} disconnected during pending request`));
    });
    
    clientState.pendingRequests.clear();
    
    // Notify all managers about the client disconnection
    const managers = globalRegistry.get(serverName);
    if (managers) {
      log(LOG_LEVELS.INFO, `Notifying ${managers.length} managers about disconnect of ${serverName}`);
      
      // Make a copy to avoid modification during iteration
      [...managers].forEach(manager => {
        if (manager.state.activeClients[serverName]) {
          const newActiveClients = copyActiveClients(manager.state.activeClients);
          delete newActiveClients[serverName];
          
          log(LOG_LEVELS.INFO, `Removing client ${serverName} from manager ${manager.id}`);
          
          // Create and apply a new state
          const newState: ManagerStateType = {
            ...manager.state,
            activeClients: newActiveClients
          };
          
          manager.updateState(newState);
        }
      });
    }
  } catch (err) {
    logError(LOG_LEVELS.ERROR, `Error during disconnect for ${serverName}: ${String(err)}`);
  }
};