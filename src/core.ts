import { DEFAULT_REQUEST_TIMEOUT_MS, MCP_PROTOCOL_VERSION } from './constants';
import { ManagerConfig, ManagerOptions, ManagerStateType, ClientState, StdioTransportConfig, JsonRpcMessage, Transport, JsonRpcRequest, JsonRpcNotification, SseTransportConfig, ClientAPI, Tool, Resource, Prompt, NotificationHandler, ManagerAPI, PendingRequests, JsonRpcResponse } from './types';
import { createMcpError, processStdioBuffer, safeJsonParse, generateId, createJsonRpcRequest, createJsonRpcNotification } from './utils';
  // --- State Management ---
  
  const createInitialState = (
    config: ManagerConfig,
    options?: ManagerOptions
  ): ManagerStateType => {
    const defaultOptions: Required<ManagerOptions> = {
      onNotification: options?.onNotification ?? (() => {}),
      requestTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    return {
      config,
      options: defaultOptions,
      activeClients: {},
    };
  };
  
  const addClientToState = (
    prevState: ManagerStateType,
    clientState: ClientState
  ): ManagerStateType => {
    return {
      ...prevState,
      activeClients: {
        ...prevState.activeClients,
        [clientState.serverName]: clientState,
      },
    };
  };
  
  const removeClientFromState = (
    prevState: ManagerStateType,
    serverName: string
  ): ManagerStateType => {
    const { [serverName]: _, ...remainingClients } = prevState.activeClients;
    return {
      ...prevState,
      activeClients: remainingClients,
    };
  };
  
  // --- Transport Creation ---
  
  const createStdioTransport = async (
    serverName: string,
    config: StdioTransportConfig,
    handleMessage: (message: JsonRpcMessage) => void,
    handleError: (error: Error) => void,
    handleExit: (code: number | null) => void
  ): Promise<Transport> => {
    try {
        const proc = Bun.spawn({
          cmd: [config.command, ...(config.args ?? [])],
          env: config.env,
          cwd: config.cwd,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });
  
        if (!proc.stdout || !proc.stdin || !proc.stderr) {
            throw createMcpError(`Failed to get stdio streams for ${serverName}`);
        }
  
        let stdoutBuffer = '';
        const stdoutReader = proc.stdout.getReader();
        const readStdout = async () => {
            try {
                while (true) {
                    const { done, value } = await stdoutReader.read();
                    if (done) break;
                    stdoutBuffer = processStdioBuffer(new TextDecoder().decode(value), stdoutBuffer, handleMessage, handleError);
                }
            } catch (err) {
                handleError(createMcpError(`Error reading stdout from ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
            } finally {
                stdoutReader.releaseLock();
            }
        };
        readStdout(); // Start reading asynchronously
  
        let stderrBuffer = '';
        const stderrReader = proc.stderr.getReader();
        const readStderr = async () => {
            try {
                while (true) {
                    const { done, value } = await stderrReader.read();
                    if (done) break;
                    stderrBuffer += new TextDecoder().decode(value);
                    // Report stderr content periodically or on newline
                    if (stderrBuffer.includes('\n')) {
                       handleError(createMcpError(`Stderr[${serverName}]: ${stderrBuffer.trim()}`));
                       stderrBuffer = ''; // Reset buffer after reporting
                    }
                }
                // Report any remaining stderr content on close
                 if (stderrBuffer.trim().length > 0) {
                     handleError(createMcpError(`Stderr[${serverName}]: ${stderrBuffer.trim()}`));
                 }
            } catch (err) {
                handleError(createMcpError(`Error reading stderr from ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
            } finally {
              stderrReader.releaseLock();
            }
        };
        readStderr(); // Start reading asynchronously
  
        proc.exited.then(handleExit).catch(err => handleError(createMcpError(`Error waiting for exit: ${err instanceof Error ? err.message : String(err)}`)));
  
  
        const send = async (message: JsonRpcRequest | JsonRpcNotification): Promise<void> => {
          const line = JSON.stringify(message) + '\n';
          try {
               await proc.stdin.write(line);
          } catch (writeError) {
              handleError(createMcpError(`Failed to write to stdin for ${serverName}: ${writeError instanceof Error ? writeError.message : String(writeError)}`));
              // Optionally try to close/kill the process here if writing fails
              await close();
              throw writeError; // Re-throw after handling
          }
        };
  
        const close = async (): Promise<void> => {
            // Attempt to close streams gracefully first, then kill
            try {
                await proc.stdin.end();
            } catch { /* Ignore errors closing stdin */ }
  
            // Cancel readers before killing
            try { await stdoutReader.cancel(); } catch {}
            try { await stderrReader.cancel(); } catch {}
  
            if (proc.pid && !proc.killed) {
                proc.kill(); // Send SIGTERM by default
                // Optionally add a timeout and send SIGKILL if it doesn't exit
                await proc.exited.catch(() => {}); // Wait for exit, ignore errors
            }
        };
  
        return { send, close, _details: { type: 'stdio', process: proc } };
  
    } catch (spawnError) {
        throw createMcpError(`Failed to spawn process for ${serverName}: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`);
    }
  };
  
  
  const createSseTransport = async (
    serverName: string,
    config: SseTransportConfig,
    handleMessage: (message: JsonRpcMessage) => void,
    handleError: (error: Error) => void
  ): Promise<Transport> => {
    const abortController = new AbortController();
    let eventSource: EventSource | null = null;
  
    const connect = () => {
        try {
            // Bun's EventSource might be available globally or require specific import
            const eventSourceInit: EventSourceInit = {};
            
            // Add headers if provided (Note: not all implementations support this)
            if (config.headers) {
              // Custom code to handle headers if available in your environment
              // Many EventSource implementations don't support headers directly
              // You might need a different solution based on your runtime
            }
            
            eventSource = new EventSource(config.url, eventSourceInit);
  
            eventSource.onmessage = (event) => {
                const message = safeJsonParse(event.data);
                if (message) {
                    handleMessage(message);
                } else {
                    handleError(createMcpError(`Received invalid JSON via SSE from ${serverName}: ${event.data.substring(0,100)}...`));
                }
            };
  
            eventSource.onerror = () => {
                // Differentiate between connection errors and other SSE errors if possible
                const errorMessage = `SSE error for ${serverName}`;
                handleError(createMcpError(errorMessage));
                // Consider implementing reconnect logic here if desired
                close(); // Close on error for now
            };
  
            eventSource.onopen = () => {
               // Optional: Log successful connection or perform action
            };
  
        } catch (e) {
            handleError(createMcpError(`Failed to establish SSE connection to ${serverName}: ${e instanceof Error ? e.message : String(e)}`));
            throw e; // Re-throw to indicate connection failure
        }
    };
  
    const send = async (message: JsonRpcRequest | JsonRpcNotification): Promise<void> => {
      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.headers ?? {}),
          },
          body: JSON.stringify(message),
          signal: abortController.signal,
        });
  
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Failed to read error body');
          throw createMcpError(`HTTP error sending message to ${serverName}: ${response.status} ${response.statusText}. Body: ${errorText}`);
        }
        // Consume body to prevent potential memory leaks if server sends one on POST
        await response.arrayBuffer().catch(() => {});
  
      } catch (fetchError) {
         if (fetchError instanceof Error && fetchError.name === 'AbortError') {
             // Ignore abort errors as they are intentional during close
             return;
         }
         handleError(createMcpError(`Failed to send message via HTTP POST to ${serverName}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`));
         throw fetchError;
      }
    };
  
    const close = async (): Promise<void> => {
        abortController.abort(); // Abort ongoing fetch requests
        if (eventSource) {
            eventSource.close();
            eventSource = null; // Clear reference
        }
    };
  
    connect(); // Initiate connection attempt immediately
  
    return { send, close, _details: { type: 'sse', abortController } };
  };
  
  
  // --- Client API Implementation ---
  
  const createClientApi = (
    getState: () => ManagerStateType,
    updateState: (newState: ManagerStateType) => void,
    clientStateRef: { current: ClientState } // Use a ref to access current client state within closures
  ): ClientAPI => {
  
    const { serverName, transport, pendingRequests } = clientStateRef.current;
    const options = getState().options; // Get manager-level options
  
    const sendRequest = <TResult = unknown>(method: string, params?: unknown): Promise<TResult> => {
      return new Promise<TResult>((resolve, reject) => {
        const id = generateId();
        const request = createJsonRpcRequest(method, params, id);
  
        // First store the callbacks without a timer
        const timeoutMessage = `Request timed out after ${options.requestTimeoutMs}ms: ${serverName} -> ${method}`;
        
        pendingRequests.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeoutTimer: setTimeout(() => {
            pendingRequests.delete(id);
            reject(createMcpError(timeoutMessage, -32000));
          }, options.requestTimeoutMs)
        });
  
        transport.send(request).catch(sendError => {
          // If sending fails immediately, reject the promise
          const resolver = pendingRequests.get(id);
          if (resolver) {
            if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer);
            resolver.reject(sendError); // Use the stored reject handler
            pendingRequests.delete(id);
          } else {
            // If the resolver isn't found (e.g., race condition with timeout), reject the outer promise
            reject(sendError);
          }
        });
      });
    };
  
    const disconnectClient = async (): Promise<void> => {
        const currentState = getState();
        const clientToRemove = currentState.activeClients[serverName];
        if (!clientToRemove) return; // Already disconnected
  
        try {
            await clientToRemove.transport.close();
        } catch (closeError) {
            console.error(`Error closing transport for ${serverName}:`, closeError);
        }
  
        // Reject any pending requests for this client
        clientToRemove.pendingRequests.forEach((resolver) => {
            if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer);
            resolver.reject(createMcpError(`Client ${serverName} disconnected while request was pending.`));
        });
        clientToRemove.pendingRequests.clear(); // Clear the map
  
        // Update manager state immutably
        const nextState = removeClientFromState(currentState, serverName);
        updateState(nextState);
    };
  
    return Object.freeze({ // Ensure the API object itself is immutable
      getCapabilities: (): Readonly<Record<string, unknown>> | undefined => {
        // Access potentially updated capabilities via the ref's current state
        return clientStateRef.current.capabilities;
      },
      callTool: <TResult = unknown>(name: string, params: Readonly<Record<string, unknown>>): Promise<TResult> => {
        return sendRequest<TResult>('tools/call', { name, params });
      },
      listTools: (): Promise<ReadonlyArray<Tool>> => {
        // Assuming tools/list returns { tools: Tool[] }
        return sendRequest<{ tools: ReadonlyArray<Tool> }>('tools/list').then(res => res.tools ?? []);
      },
      readResource: (uri: string): Promise<string | Buffer> => {
        // Assuming resources/read returns { content: string | Buffer } or similar
        // Adjust based on actual expected MCP resource read response structure
        return sendRequest<{ content: string | Buffer }>('resources/read', { uri }).then(res => res.content);
      },
      listResources: (): Promise<ReadonlyArray<Resource>> => {
        return sendRequest<{ resources: ReadonlyArray<Resource> }>('resources/list').then(res => res.resources ?? []);
      },
      listPrompts: (): Promise<ReadonlyArray<Prompt>> => {
        return sendRequest<{ prompts: ReadonlyArray<Prompt> }>('prompts/list').then(res => res.prompts ?? []);
      },
      getPrompt: (name: string, args?: Readonly<Record<string, unknown>>): Promise<string> => {
        // Assuming prompts/get returns { prompt: string } or similar
        return sendRequest<{ prompt: string }>('prompts/get', { name, args }).then(res => res.prompt);
      },
      ping: async (): Promise<void> => {
        await sendRequest('ping'); // Ping might not have a result defined in JSON-RPC spec
      },
      disconnect: disconnectClient,
    });
  };
  
  // --- Message Handling ---
  
  const handleIncomingMessage = (
    message: JsonRpcMessage,
    clientState: ClientState, // Pass the specific client state
    onNotification: NotificationHandler
  ) => {
    if ('method' in message && !('id' in message)) {
      // Notification
      try {
          onNotification(clientState.serverName, createJsonRpcNotification(message.method, message.params));
      } catch (notificationError) {
          console.error(`Error in notification handler for ${clientState.serverName}:`, notificationError);
      }
    } else if ('id' in message && message.id !== null) {
      // Response
      const resolver = clientState.pendingRequests.get(message.id);
      if (resolver) {
        if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer);
        if ('error' in message && message.error) {
          resolver.reject(createMcpError(message.error.message, message.error.code, message.error.data));
        } else if ('result' in message) {
          resolver.resolve(message.result);
        } else {
           // Should not happen with valid JSON-RPC 2.0
           resolver.reject(createMcpError(`Invalid JSON-RPC response received for ID ${message.id}`, -32603));
        }
        clientState.pendingRequests.delete(message.id); // Remove from map
      } else {
         console.warn(`Received response for unknown or timed out request ID ${message.id} from ${clientState.serverName}`);
      }
    } else {
        console.warn(`Received message that is neither a valid notification nor response from ${clientState.serverName}:`, message);
    }
  };
  
  // --- Main Manager Function ---
  
  export const manager = (
    config: ManagerConfig,
    options?: ManagerOptions
  ): ManagerAPI => {
    // Initial state
    let managerState: ManagerStateType = createInitialState(config, options);
    
    // Track pending connections by server name
    const pendingConnections = new Map<string, Promise<void>>();
  
    const updateManagerState = (newState: ManagerStateType): void => {
        managerState = newState;
    };
  
    const getManagerState = (): ManagerStateType => {
        return managerState;
    };
  
    // This function connects to a server asynchronously
    const connectToServer = async (serverName: string): Promise<void> => {
      // Skip if already connected
      if (managerState.activeClients[serverName]) {
        return;
      }
      
      // Make sure we don't have a pending connection already
      if (pendingConnections.has(serverName)) {
        // If we have a pending connection, just wait for it
        try {
          await pendingConnections.get(serverName);
          return; // Connection succeeded
        } catch (error) {
          // Connection failed, let's try again
          pendingConnections.delete(serverName);
        }
      }
      
      // Create a new connection promise
      const connectionPromise = (async () => {
        // Validate server config exists
        const serverConfig = managerState.config[serverName];
        if (!serverConfig) {
          throw createMcpError(`Server configuration not found for "${serverName}"`);
        }
        
        const pendingRequests: PendingRequests = new Map();
        let transport: Transport | null = null;
        let clientStateRef: { current: ClientState } | null = null;
        
        const handleError = (error: Error): void => {
            console.error(`Error from ${serverName}:`, error);
            if (clientStateRef?.current) {
               clientStateRef.current.clientAPI.disconnect().catch(disconnectErr => 
                 console.error(`Error during auto-disconnect of ${serverName}:`, disconnectErr));
            } else if (transport) {
               transport.close().catch(closeErr => 
                 console.error(`Error closing transport during error handling for ${serverName}:`, closeErr));
            }
            updateManagerState(removeClientFromState(getManagerState(), serverName));
        };
        
        const handleExit = (code: number | null): void => {
            console.warn(`Server process ${serverName} exited with code ${code ?? 'unknown'}.`);
            handleError(createMcpError(`Server process ${serverName} exited unexpectedly.`));
        };
        
        const messageHandler = (message: JsonRpcMessage): void => {
            if (clientStateRef?.current) {
                handleIncomingMessage(message, clientStateRef.current, managerState.options.onNotification);
            } else {
                console.warn(`Received message from ${serverName} before client state was fully initialized. Discarding.`);
            }
        };
        
        try {
            // Create Transport
            if (serverConfig.transport.type === 'stdio') {
                transport = await createStdioTransport(
                    serverName, 
                    serverConfig.transport, 
                    messageHandler, 
                    handleError, 
                    handleExit
                );
            } else if (serverConfig.transport.type === 'sse') {
                transport = await createSseTransport(
                    serverName, 
                    serverConfig.transport, 
                    messageHandler, 
                    handleError
                );
            } else {
                throw createMcpError(`Unsupported transport type for server ${serverName}`);
            }
            
            // Initialize: Send 'initialize' request
            const initRequest = createJsonRpcRequest('initialize', {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {}, // Client capabilities can be added here
            });
            
            // Create a Promise for the initialization response
            const initResponsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
                const timeoutMessage = `Initialization timed out for ${serverName} after ${managerState.options.requestTimeoutMs}ms`;
                
                // Store the callbacks with the timer
                pendingRequests.set(initRequest.id, {
                  resolve: resolve as (value: unknown) => void,
                  reject,
                  timeoutTimer: setTimeout(() => {
                    pendingRequests.delete(initRequest.id);
                    reject(createMcpError(timeoutMessage, -32000));
                  }, managerState.options.requestTimeoutMs)
                });
            });
            
            // Send the initialization request
            await transport.send(initRequest);
            
            // Wait for the response
            const initResponse = await initResponsePromise;
            
            if (initResponse.error) {
                throw createMcpError(
                    `Initialization failed for ${serverName}: ${initResponse.error.message}`, 
                    initResponse.error.code, 
                    initResponse.error.data
                );
            }
            
            // Extract server capabilities
            const serverCapabilities = (initResponse.result as { capabilities?: Record<string, unknown> })?.capabilities ?? {};
            
            // Create client state and API
            const tempClientState = {
                serverName,
                config: serverConfig,
                transport,
                pendingRequests,
                capabilities: serverCapabilities,
                clientAPI: null as unknown as ClientAPI, // Will be replaced
            };
            
            // Initialize the reference for closures
            clientStateRef = { current: tempClientState };
            
            // Create client API that closes over the reference
            const clientApi = createClientApi(getManagerState, updateManagerState, clientStateRef);
            
            // Update the client state with the API
            const finalClientState: ClientState = {
                ...tempClientState,
                clientAPI: clientApi,
            };
            
            // Update the reference
            clientStateRef.current = finalClientState;
            
            // Send initialized notification (fire and forget)
            await transport.send(createJsonRpcRequest('initialized', {}) as JsonRpcNotification);
            
            // Update manager state
            updateManagerState(addClientToState(getManagerState(), finalClientState));
            
        } catch (error) {
            if (transport) {
                await transport.close().catch(closeErr => 
                  console.error(`Error closing transport during init error for ${serverName}:`, closeErr));
            }
            
            pendingRequests.forEach((resolver) => {
                if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer);
                resolver.reject(error);
            });
            
            console.error(`Failed to initialize server ${serverName}:`, error);
            throw error; // Re-throw to notify the caller
        } finally {
            // We don't delete the pending connection here
            // That will be done after the promise resolves or rejects
        }
      })();
      
      // Store the connection promise
      pendingConnections.set(serverName, connectionPromise);
      
      try {
        // Wait for connection to complete
        await connectionPromise;
      } finally {
        // Always clean up the pending connection regardless of success/failure
        pendingConnections.delete(serverName);
      }
    };
  
    // The use method exposed in the API
    const useServer = async (serverName: string): Promise<ManagerAPI> => {
      try {
        // Connect to the server and wait for completion
        await connectToServer(serverName);
        // Return a new manager instance (chainable)
        return createManagerApi();
      } catch (error) {
        // Re-throw the error
        throw error;
      }
    };
  
    // Get client API for a specific server
    const getClient = (serverName: string): ClientAPI | undefined => {
      // If there's a pending connection for this server, we can't wait here
      const pending = pendingConnections.get(serverName);
      if (pending) {
        // We need to wait for the connection to complete before we can get the client
        // This will throw an error if the connection fails, which is expected behavior
        // Return undefined since we can't wait for the promise to resolve in a synchronous function
        pending.catch(err => console.error(`Error connecting to ${serverName}:`, err));
      }
      
      // Return the client if it exists
      return managerState.activeClients[serverName]?.clientAPI;
    };
  
    // Get client API for a specific server and wait for pending connection if needed
    const getClientAsync = async (serverName: string): Promise<ClientAPI | undefined> => {
      // If there's a pending connection for this server, wait for it first
      const pending = pendingConnections.get(serverName);
      if (pending) {
        try {
          await pending;
        } catch (err) {
          console.error(`Error connecting to ${serverName}:`, err);
          return undefined;
        }
      }
      
      // Return the client if it exists
      return managerState.activeClients[serverName]?.clientAPI;
    };
  
    // Disconnect all active clients
    const disconnectAll = async (): Promise<void> => {
      // Wait for all pending connections to complete (either successfully or with errors)
      if (pendingConnections.size > 0) {
        // Create a list of all pending connections
        const allPendingConnections = Array.from(pendingConnections.values());
        
        // Wait for all connections to settle (either resolve or reject)
        await Promise.allSettled(allPendingConnections);
      }
      
      // Get all active clients
      const currentClients = Object.values(managerState.activeClients);
      
      // Disconnect each client
      const disconnectPromises = currentClients.map(client =>
          client.clientAPI.disconnect().catch(err => {
              console.error(`Error disconnecting client ${client.serverName}:`, err);
          }));
      
      // Wait for all disconnect operations to complete
      await Promise.all(disconnectPromises);
    };
  
    // Create the manager API
    const createManagerApi = (): ManagerAPI => {
      return Object.freeze({
          use: useServer,
          getClient,
          getClientAsync,
          disconnectAll,
          _getState: getManagerState
      });
    };
  
    return createManagerApi();
  };
  
  // --- Export the Manager Function ---
  
  export const managerFunction = manager;