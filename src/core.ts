import { DEFAULT_REQUEST_TIMEOUT_MS, JSONRPC_VERSION, MCP_PROTOCOL_VERSION } from './constants';
import { ManagerConfig, ManagerOptions, ManagerStateType, StdioTransportConfig, JsonRpcMessage, Transport, JsonRpcRequest, JsonRpcNotification, SseTransportConfig, ClientAPI, Tool, Resource, Prompt, ManagerAPI, PendingRequests, JsonRpcResponse, ManagerStateInternals } from './types';
import { createMcpError, processStdioBuffer, safeJsonParse, generateId, createJsonRpcRequest, createJsonRpcNotification } from './utils';

// Core functionality for managing MCP (Model Control Protocol) servers
export const manager = (config: ManagerConfig, options?: ManagerOptions): ManagerAPI => {
  // State
  let state: ManagerStateType = {
    config,
    options: {
      onNotification: options?.onNotification ?? (() => {}),
      requestTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
    activeClients: {},
  };
  const pendingConnections = new Map<string, Promise<void>>();
  const updateState = (newState: ManagerStateType): void => { state = newState; };
  
  // Transports: Create stdio transport
  const createTransport = async (
    serverName: string,
    config: StdioTransportConfig | SseTransportConfig,
    messageHandler: (message: JsonRpcMessage) => void,
    errorHandler: (error: Error) => void,
    exitHandler?: (code: number | null) => void
  ): Promise<Transport> => {
    if (config.type === 'stdio') {
      const stdioCfg = config as StdioTransportConfig;
      const proc = Bun.spawn({
        cmd: [stdioCfg.command, ...(stdioCfg.args ?? [])],
        env: stdioCfg.env, cwd: stdioCfg.cwd,
        stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
      });

      if (!proc.stdout || !proc.stdin || !proc.stderr) 
        throw createMcpError(`Failed to get stdio streams for ${serverName}`);

      // Create readers for streams
      const stdoutReader = proc.stdout.getReader();
      const stderrReader = proc.stderr.getReader();

      // Process streams
      const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>, processor: (t: string, b: string) => string, 
        buffer = '', errorMsg: string, errFn = errorHandler) => {
        try {
          let buf = buffer;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf = processor(new TextDecoder().decode(value), buf);
          }
        } catch (err) { errFn(createMcpError(`${errorMsg}: ${String(err)}`)); }
      };

      // Handle stdout and stderr
      processStream(
        stdoutReader,
        (text, buffer) => processStdioBuffer(text, buffer, messageHandler, errorHandler),
        '',
        `Error reading stdout from ${serverName}`
      ).catch(err => errorHandler(createMcpError(`Fatal stdout reader error: ${String(err)}`)));

      processStream(
        stderrReader,
        (text, buffer) => {
          const lines = (buffer + text).split('\n');
          lines.slice(0, -1).forEach(line => { 
            if (line.trim()) console.error(`${serverName} stderr: ${line.trim()}`);
          });
          return lines[lines.length - 1];
        },
        '',
        `Error reading stderr from ${serverName}`,
        err => console.error(`${String(err)}`)
      ).catch(err => console.error(`Fatal stderr reader error: ${String(err)}`));

      // Process exit handling
      proc.exited.then(exitHandler || (() => {}))
        .catch(err => errorHandler(createMcpError(`Process exit handler error: ${String(err)}`)));

      // Transport interface
      const cleanup = async () => {
        try {
          await Promise.allSettled([
            stdoutReader.cancel(),
            stderrReader.cancel(),
            proc.stdin.end()
          ]);
          if (proc.pid && !proc.killed) {
            proc.kill();
            await Promise.race([proc.exited, new Promise(r => setTimeout(r, 1000))]);
          }
        } catch (err) {
          console.error(`Error closing stdio transport: ${String(err)}`);
        }
      };

      return {
        send: async (message: JsonRpcRequest | JsonRpcNotification) => {
          try {
            await proc.stdin.write(new TextEncoder().encode(JSON.stringify(message) + '\n'));
          } catch (err) {
            errorHandler(createMcpError(`Failed to write to stdin: ${String(err)}`));
            await cleanup();
            throw err;
          }
        },
        close: cleanup,
        _details: { type: 'stdio', process: proc }
      };
    } else { // SSE transport
      const sseCfg = config as SseTransportConfig;
      const abortController = new AbortController();
      let eventSource: EventSource | null = null;
      let connected = false;
      let connectPromise: Promise<void> | null = null;

      // Connection management
      const connect = (): Promise<void> => {
        if (connectPromise) return connectPromise;
        
        connectPromise = new Promise<void>((resolve, reject) => {
          try {
            eventSource = new EventSource(sseCfg.url, {});
            const timeout = setTimeout(() => {
              if (!connected) {
                reject(createMcpError(`SSE connection timeout for ${serverName}`));
                connectPromise = null;
                if (eventSource) { eventSource.close(); eventSource = null; }
              }
            }, 5000);
            
            // Event handlers
            eventSource.onmessage = ({ data }) => {
              try {
                const message = safeJsonParse(data);
                message 
                  ? messageHandler(message) 
                  : errorHandler(createMcpError(`Invalid JSON via SSE: ${data.substring(0, 100)}...`));
              } catch (err) {
                errorHandler(createMcpError(`SSE message error: ${String(err)}`));
              }
            };
    
            eventSource.onerror = () => {
              if (!connected) {
                reject(createMcpError(`SSE connection error for ${serverName}`));
                connectPromise = null;
              } else {
                errorHandler(createMcpError(`SSE error for ${serverName}`));
              }
            };
            
            eventSource.onopen = () => { connected = true; resolve(); };
            
            // Cleanup
            eventSource.addEventListener('open', () => clearTimeout(timeout));
            eventSource.addEventListener('error', () => clearTimeout(timeout));
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
            const response = await fetch(sseCfg.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(sseCfg.headers ?? {}) },
              body: JSON.stringify(message),
              signal: abortController.signal,
            });
    
            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Failed to read error body');
              throw createMcpError(`HTTP error (${response.status}): ${errorText}`);
            }
            await response.arrayBuffer().catch(() => {});
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            throw createMcpError(`Failed to send via HTTP POST: ${String(err)}`);
          }
        },
        close: async () => {
          abortController.abort();
          if (eventSource) { eventSource.close(); eventSource = null; }
          connected = false;
          connectPromise = null;
        },
        _details: { type: 'sse', abortController }
      };
    }
  };

  // Message handling
  const handleMessage = (message: JsonRpcMessage, serverName: string, pendingRequests: PendingRequests): void => {
    const client = state.activeClients[serverName];
    
    // Handle notifications (no ID)
    if ('method' in message && (!('id' in message) || message.id === null)) {
      try { state.options.onNotification(serverName, createJsonRpcNotification(message.method, message.params)); } 
      catch (err) { console.error(`Notification handler error for ${serverName}:`, err); }
      return;
    }
    
    // Handle responses (with ID)
    if ('id' in message && message.id !== null) {
      const resolver = (client?.pendingRequests || pendingRequests).get(message.id);
      if (!resolver) {
        console.warn(`Response for unknown request ID ${message.id} from ${serverName}`);
        return;
      }
      
      if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
      
      if ('error' in message && message.error) {
        resolver.reject(createMcpError(message.error.message || 'Unknown error', message.error.code, message.error.data));
      } else if ('result' in message) {
        resolver.resolve(message.result);
      } else {
        resolver.reject(createMcpError(`Invalid JSON-RPC response for ID ${message.id}`, -32603));
      }
      
      (client?.pendingRequests || pendingRequests).delete(message.id);
    }
  };

  // Client API creation
  const createClientApi = (
    serverName: string, transport: Transport, pendingRequests: PendingRequests,
    capabilities?: Readonly<Record<string, unknown>>, setIntentionalDisconnect?: (value: boolean) => void
  ): ClientAPI => {
    const sendRequest = <TResult = unknown>(method: string, params?: unknown): Promise<TResult> => 
      new Promise<TResult>((resolve, reject) => {
        const id = generateId();
        const timeoutTimer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(createMcpError(`Request timed out after ${state.options.requestTimeoutMs}ms: ${method}`, -32000));
        }, state.options.requestTimeoutMs);
        
        pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeoutTimer });
        transport.send(createJsonRpcRequest(method, params, id))
          .catch(err => {
            clearTimeout(timeoutTimer);
            pendingRequests.delete(id);
            reject(err);
          });
      });
    
    const disconnect = async (): Promise<void> => {
      if (setIntentionalDisconnect) setIntentionalDisconnect(true);
      
      try { await transport.close(); } 
      catch (err) { console.error(`Error closing transport for ${serverName}:`, err); }
      
      pendingRequests.forEach(resolver => {
        if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
        resolver.reject(createMcpError(`Client ${serverName} disconnected during pending request`));
      });
      
      pendingRequests.clear();
      
      if (state.activeClients[serverName]) {
        const { [serverName]: _, ...remainingClients } = state.activeClients;
        updateState({ ...state, activeClients: remainingClients });
      }
    };

    return Object.freeze({
      getCapabilities: () => capabilities,
      callTool: <TResult = unknown>(name: string, params: Record<string, unknown>) => 
        sendRequest<TResult>('call_tool', { name, params }),
      listTools: () => sendRequest<{ tools: ReadonlyArray<Tool> }>('list_tools').then(res => res.tools ?? []),
      readResource: (uri: string) => 
        sendRequest<{ content: string | Buffer }>('read_resource', { uri }).then(res => res.content),
      listResources: () => 
        sendRequest<{ resources: ReadonlyArray<Resource> }>('list_resources').then(res => res.resources ?? []),
      listPrompts: () => sendRequest<{ prompts: ReadonlyArray<Prompt> }>('prompts/list').then(res => res.prompts ?? []),
      getPrompt: (name: string, args?: Record<string, unknown>) => 
        sendRequest<{ prompt: string }>('prompts/get', { name, args }).then(res => res.prompt),
      ping: async () => { await sendRequest('ping'); },
      disconnect,
    });
  };

  // Connect to server
  const connectToServer = async (serverName: string): Promise<ManagerStateType> => {
    // Return existing connection or wait for pending connection
    if (state.activeClients[serverName]) return state;
    if (pendingConnections.has(serverName)) {
      try { await pendingConnections.get(serverName); return state; }
      catch { pendingConnections.delete(serverName); }
    }
    
    const connectionPromise = (async (): Promise<ManagerStateType> => {
      const serverConfig = state.config[serverName];
      if (!serverConfig) throw createMcpError(`Server configuration not found: "${serverName}"`);
      
      const pendingRequests: PendingRequests = new Map();
      let transport: Transport | null = null;
      let intentionalDisconnect = false;
      
      const cleanup = (removeFromState = true) => {
        if (transport) transport.close().catch(err => console.error(`Error closing transport:`, err));
        if (removeFromState && state.activeClients[serverName]) {
          const { [serverName]: _, ...remainingClients } = state.activeClients;
          updateState({ ...state, activeClients: remainingClients });
        }
      };
      
      try {
        // Create handlers and transport
        const onError = (error: Error) => { console.error(`Error from ${serverName}:`, error); cleanup(); };
        const onExit = (code: number | null) => {
          const exitMsg = `Server process ${serverName} exited with code ${code ?? 'unknown'}`;
          if (intentionalDisconnect || code === 143 || code === 0) {
            console.log(exitMsg);
          } else {
            console.warn(`${exitMsg} (unexpected)`);
            onError(createMcpError(exitMsg));
          }
        };
        
        transport = await createTransport(
          serverName, serverConfig.transport,
          msg => handleMessage(msg, serverName, pendingRequests),
          onError, onExit
        );
        
        // Initialize the server
        const initRequest = createJsonRpcRequest('initialize', 
          { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} });
        await transport.send(initRequest);
        
        // Wait for initialization response
        const initTimeoutMs = Math.min(state.options.requestTimeoutMs, 10000);
        const initResponse = await new Promise<JsonRpcResponse>((resolve, reject) => {
          const timeoutTimer = setTimeout(() => {
            pendingRequests.delete(initRequest.id);
            reject(createMcpError(`Initialization timed out after ${initTimeoutMs}ms`, -32000));
          }, initTimeoutMs);
          
          pendingRequests.set(initRequest.id, {
            resolve: resolve as (value: unknown) => void,
            reject, timeoutTimer,
          });
        });
        
        if ('error' in initResponse && initResponse.error) {
          throw createMcpError(`Initialization failed: ${initResponse.error.message}`, 
            initResponse.error.code, initResponse.error.data);
        }
        
        // Setup client and update state
        const capabilities = (initResponse.result as { capabilities?: Record<string, unknown> } || {}).capabilities ?? {};
        const clientApi = createClientApi(
          serverName, transport, pendingRequests, capabilities,
          value => { intentionalDisconnect = value; }
        );
        
        updateState({
          ...state,
          activeClients: {
            ...state.activeClients,
            [serverName]: {
              serverName, config: serverConfig, transport, pendingRequests,
              capabilities, clientAPI: clientApi,
            },
          }
        });
        
        // Complete initialization
        await transport.send({ jsonrpc: JSONRPC_VERSION, method: 'initialized', params: {} });
        return state;
      } catch (err) {
        // Cleanup on error
        intentionalDisconnect = true;
        pendingRequests.forEach(resolver => {
          if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
          resolver.reject(err);
        });
        
        pendingRequests.clear();
        pendingConnections.delete(serverName);
        cleanup();
        throw err;
      }
    })();
    
    pendingConnections.set(serverName, connectionPromise.then(() => {}));
    
    try { return await connectionPromise; } 
    catch (err) {
      pendingConnections.delete(serverName);
      if (state.activeClients[serverName]) {
        const { [serverName]: _, ...remainingClients } = state.activeClients;
        updateState({ ...state, activeClients: remainingClients });
      }
      throw err;
    }
  };

  // Public API
  return Object.freeze({
    use: async (serverName: string): Promise<ManagerAPI> => {
      try {
        const updatedState = await connectToServer(serverName);
        const newManager = manager(updatedState.config, state.options);
        
        newManager._getState().updateState({
          ...newManager._getState().state,
          activeClients: { ...updatedState.activeClients }
        });
        
        updateState({ ...state, activeClients: {} });
        Object.keys(updatedState.activeClients).forEach(key => pendingConnections.delete(key));
        
        return newManager;
      } catch (err) {
        pendingConnections.delete(serverName);
        const client = state.activeClients[serverName]?.clientAPI;
        if (client) await client.disconnect().catch(() => {});
        
        if (state.activeClients[serverName]) {
          const { [serverName]: _, ...remainingClients } = state.activeClients;
          updateState({ ...state, activeClients: remainingClients });
        }
        
        throw err;
      }
    },
    
    getClient: (serverName: string) => state.activeClients[serverName]?.clientAPI,
    
    getClientAsync: async (serverName: string) => {
      if (pendingConnections.has(serverName)) {
        try { 
          await pendingConnections.get(serverName); 
        } catch (err) {
          console.error(`Error connecting to ${serverName}:`, err);
          if (state.activeClients[serverName]) {
            const { [serverName]: _, ...remainingClients } = state.activeClients;
            updateState({ ...state, activeClients: remainingClients });
          }
          return undefined;
        }
      }
      return state.activeClients[serverName]?.clientAPI;
    },
    
    disconnectAll: async () => {
      await Promise.allSettled(Array.from(pendingConnections.values()));
      await Promise.all(
        Object.values(state.activeClients).map(client => 
          client.clientAPI.disconnect().catch(err => 
            console.error(`Error disconnecting ${client.serverName}:`, err)
          )
        )
      );
      
      if (Object.keys(state.activeClients).length > 0) {
        updateState({ ...state, activeClients: {} });
      }
    },
    
    _getState: (): ManagerStateInternals => ({
      state, updateState, config: state.config,
      options: state.options, activeClients: state.activeClients
    }),
  });
};

export const managerFunction = manager;