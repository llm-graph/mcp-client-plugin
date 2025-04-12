import { DEFAULT_REQUEST_TIMEOUT_MS, JSONRPC_VERSION, MCP_PROTOCOL_VERSION } from './constants';
import { ManagerConfig, ManagerOptions, ManagerStateType, ClientState, StdioTransportConfig, JsonRpcMessage, Transport, JsonRpcRequest, JsonRpcNotification, SseTransportConfig, ClientAPI, Tool, Resource, Prompt, NotificationHandler, ManagerAPI, PendingRequests, JsonRpcResponse, ManagerStateInternals } from './types';
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

        // Start reading stdout asynchronously
        const readStdout = async () => {
          try {
            while (true) {
              const { done, value } = await stdoutReader.read();
              if (done) break;
              
              const decodedValue = new TextDecoder().decode(value);
              stdoutBuffer = processStdioBuffer(decodedValue, stdoutBuffer, handleMessage, handleError);
            }
          } catch (err) {
            handleError(createMcpError(`Error reading stdout from ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
          }
        };
        
        // Start the stdout reading process but don't await it
        readStdout().catch(err => {
          handleError(createMcpError(`Fatal error in stdout reader for ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
        });
  
        // Handle stderr
        let stderrBuffer = '';
        const stderrReader = proc.stderr.getReader();
        
        // Start reading stderr asynchronously
        const readStderr = async () => {
          try {
            while (true) {
              const { done, value } = await stderrReader.read();
              if (done) break;
              
              stderrBuffer += new TextDecoder().decode(value);
              
              // Process complete stderr lines when available
              const lines = stderrBuffer.split('\n');
              if (lines.length > 1) {
                // Handle all complete lines except the last one (which might be incomplete)
                for (let i = 0; i < lines.length - 1; i++) {
                  const line = lines[i].trim();
                  if (line) {
                    // Just log to console for debugging - don't generate errors for stderr output
                    console.error(`${serverName} stderr: ${line}`);
                  }
                }
                // Keep the last potentially incomplete line
                stderrBuffer = lines[lines.length - 1];
              }
            }
            
            // Handle any remaining data in the buffer
            if (stderrBuffer.trim()) {
              console.error(`${serverName} stderr (final): ${stderrBuffer.trim()}`);
            }
          } catch (err) {
            console.error(`Error reading stderr from ${serverName}: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        
        // Start the stderr reading process but don't await it
        readStderr().catch(err => {
          console.error(`Fatal error in stderr reader for ${serverName}: ${err instanceof Error ? err.message : String(err)}`);
        });
  
        // Handle process exit
        proc.exited.then(handleExit).catch(err => {
          handleError(createMcpError(`Error in process exit handler for ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
        });
  
        // Send function
        const send = async (message: JsonRpcRequest | JsonRpcNotification): Promise<void> => {
          const line = JSON.stringify(message) + '\n';
          try {
            const encoder = new TextEncoder();
            const data = encoder.encode(line);
            await proc.stdin.write(data);
          } catch (writeError) {
            handleError(createMcpError(`Failed to write to stdin for ${serverName}: ${writeError instanceof Error ? writeError.message : String(writeError)}`));
            await close();
            throw writeError;
          }
        };
  
        // Close function
        const close = async (): Promise<void> => {
          // Try to gracefully close everything
          try {
            // Cancel any active readers first
            try { await stdoutReader.cancel(); } catch (err) { /* Ignore errors */ }
            try { await stderrReader.cancel(); } catch (err) { /* Ignore errors */ }
            
            // Close stdin if possible
            try { 
              await proc.stdin.end(); 
            } catch (err) { /* Ignore errors */ }
          } catch (err) {
            console.error(`Error during stream cleanup for ${serverName}:`, err);
          }
  
          // Kill the process if it's still running
          if (proc.pid && !proc.killed) {
            try {
              proc.kill();
              // Wait for the process to exit with a timeout
              const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 1000));
              await Promise.race([proc.exited, timeoutPromise]);
            } catch (err) {
              console.error(`Error killing process for ${serverName}:`, err);
            }
          }
        };
  
        return { 
          send, 
          close, 
          _details: { 
            type: 'stdio', 
            process: proc 
          } 
        };
  
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
    // Create an abort controller for fetch requests
    const abortController = new AbortController();
    let eventSource: EventSource | null = null;
    let connected = false;
    let connectPromise: Promise<void> | null = null;
  
    // Create a connection promise that resolves when the connection is established
    // or rejects if there's an error
    const connect = (): Promise<void> => {
      if (connectPromise) {
        return connectPromise;
      }
  
      connectPromise = new Promise<void>((resolve, reject) => {
        try {
          // Create EventSource options
          const eventSourceInit: EventSourceInit = {};
          
          // Create the EventSource
          eventSource = new EventSource(config.url, eventSourceInit);
          
          // Set up event handlers
          eventSource.onmessage = (event) => {
            try {
              const message = safeJsonParse(event.data);
              if (message) {
                handleMessage(message);
              } else {
                handleError(createMcpError(`Received invalid JSON via SSE from ${serverName}: ${event.data.substring(0, 100)}...`));
              }
            } catch (err) {
              handleError(createMcpError(`Error processing SSE message from ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
            }
          };
          
          eventSource.onerror = () => {
            if (!connected) {
              // If we haven't connected yet, reject the connection promise
              reject(createMcpError(`SSE connection error for ${serverName}`));
              connectPromise = null;
            } else {
              // Otherwise just report the error
              handleError(createMcpError(`SSE error for ${serverName}`));
            }
          };
          
          eventSource.onopen = () => {
            connected = true;
            resolve();
          };
          
          // Set a timeout for the initial connection
          const timeout = setTimeout(() => {
            if (!connected) {
              reject(createMcpError(`SSE connection timeout for ${serverName}`));
              connectPromise = null;
              close().catch(() => {});
            }
          }, 5000); // 5 second timeout
          
          // Clean up the timeout when we connect or error out
          eventSource.addEventListener('open', () => clearTimeout(timeout));
          eventSource.addEventListener('error', () => clearTimeout(timeout));
        } catch (err) {
          reject(createMcpError(`Failed to establish SSE connection to ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
          connectPromise = null;
        }
      });
      
      return connectPromise;
    };
  
    // Create the send function
    const send = async (message: JsonRpcRequest | JsonRpcNotification): Promise<void> => {
      // Make sure we're connected first
      if (!connected) {
        await connect();
      }
  
      // Send the message via HTTP POST
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
          // Try to read the error body if there is one
          let errorText = '';
          try {
            errorText = await response.text();
          } catch {
            errorText = 'Failed to read error body';
          }
          
          throw createMcpError(`HTTP error sending message to ${serverName}: ${response.status} ${response.statusText}. Body: ${errorText}`);
        }
  
        // Consume and discard the response body
        await response.arrayBuffer().catch(() => {});
      } catch (fetchError) {
        // Ignore abort errors as they are intentional
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return;
        }
        
        throw createMcpError(`Failed to send message via HTTP POST to ${serverName}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }
    };
  
    // Create the close function
    const close = async (): Promise<void> => {
      // Abort any ongoing fetch requests
      abortController.abort();
      
      // Close the EventSource if it exists
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      
      // Reset connection state
      connected = false;
      connectPromise = null;
    };
  
    // Start the connection immediately but don't wait for it
    connect().catch(err => {
      handleError(createMcpError(`Initial SSE connection failed for ${serverName}: ${err instanceof Error ? err.message : String(err)}`));
    });
  
    return {
      send,
      close,
      _details: {
        type: 'sse',
        abortController,
      }
    };
  };
  
  
  // --- Client API Implementation ---
  
  const createClientApi = (
    serverName: string,
    getState: () => ManagerStateType,
    updateState: (newState: ManagerStateType) => void,
    transport: Transport,
    pendingRequests: PendingRequests,
    capabilities?: Readonly<Record<string, unknown>>,
    setIntentionalDisconnect?: (value: boolean) => void
  ): ClientAPI => {
    const options = getState().options;
  
    // Send a JSON-RPC request and handle the response
    const sendRequest = <TResult = unknown>(method: string, params?: unknown): Promise<TResult> => {
      return new Promise<TResult>((resolve, reject) => {
        // Generate a unique ID for this request
        const id = generateId();
        
        // Create the request object
        const request = createJsonRpcRequest(method, params, id);
        
        // Set up a timeout for this request
        const timeoutMs = options.requestTimeoutMs;
        const timeoutMessage = `Request timed out after ${timeoutMs}ms: ${serverName} -> ${method}`;
        
        // Store the resolver and timeout
        const timeoutTimer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(createMcpError(timeoutMessage, -32000));
        }, timeoutMs);
        
        // Add the request to the pending requests map
        pendingRequests.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeoutTimer,
        });
        
        // Send the request
        transport.send(request).catch(sendError => {
          // If sending fails, clean up and reject
          clearTimeout(timeoutTimer);
          pendingRequests.delete(id);
          reject(sendError);
        });
      });
    };
  
    // Disconnect this client
    const disconnectClient = async (): Promise<void> => {
      // Mark this as an intentional disconnect
      if (setIntentionalDisconnect) {
        setIntentionalDisconnect(true);
      }
      
      // Close the transport
      try {
        await transport.close();
      } catch (closeError) {
        console.error(`Error closing transport for ${serverName}:`, closeError);
      }
      
      // Reject any pending requests
      pendingRequests.forEach((resolver) => {
        if (resolver.timeoutTimer) {
          clearTimeout(resolver.timeoutTimer as number);
        }
        resolver.reject(createMcpError(`Client ${serverName} disconnected while request was pending`));
      });
      
      // Clear the pending requests map
      pendingRequests.clear();
      
      // Update the state to remove this client using the removeClientFromState function
      const currentState = getState();
      updateState(removeClientFromState(currentState, serverName));
    };
  
    // Create the client API
    return Object.freeze({
      getCapabilities: (): Readonly<Record<string, unknown>> | undefined => {
        return capabilities;
      },
      
      callTool: <TResult = unknown>(name: string, params: Readonly<Record<string, unknown>>): Promise<TResult> => {
        return sendRequest<TResult>('tools/call', { name, params });
      },
      
      listTools: (): Promise<ReadonlyArray<Tool>> => {
        return sendRequest<{ tools: ReadonlyArray<Tool> }>('tools/list').then(res => res.tools ?? []);
      },
      
      readResource: (uri: string): Promise<string | Buffer> => {
        return sendRequest<{ content: string | Buffer }>('resources/read', { uri }).then(res => res.content);
      },
      
      listResources: (): Promise<ReadonlyArray<Resource>> => {
        return sendRequest<{ resources: ReadonlyArray<Resource> }>('resources/list').then(res => res.resources ?? []);
      },
      
      listPrompts: (): Promise<ReadonlyArray<Prompt>> => {
        return sendRequest<{ prompts: ReadonlyArray<Prompt> }>('prompts/list').then(res => res.prompts ?? []);
      },
      
      getPrompt: (name: string, args?: Readonly<Record<string, unknown>>): Promise<string> => {
        return sendRequest<{ prompt: string }>('prompts/get', { name, args }).then(res => res.prompt);
      },
      
      ping: async (): Promise<void> => {
        await sendRequest('ping');
      },
      
      disconnect: disconnectClient,
    });
  };
  
  // --- Message Handling ---
  
  const handleIncomingMessage = (
    message: JsonRpcMessage,
    clientState: ClientState,
    onNotification: NotificationHandler
  ): void => {
    // Handle notifications (no ID and has method property)
    if ('method' in message && (!('id' in message) || message.id === null)) {
      try {
        onNotification(clientState.serverName, createJsonRpcNotification(message.method, message.params));
      } catch (notificationError) {
        console.error(`Error in notification handler for ${clientState.serverName}:`, notificationError);
      }
      return;
    }
    
    // Handle responses (has ID and result or error property)
    if ('id' in message && message.id !== null) {
      const id = message.id;
      const resolver = clientState.pendingRequests.get(id);
      
      if (resolver) {
        // Clear the timeout
        if (resolver.timeoutTimer) {
          clearTimeout(resolver.timeoutTimer as number);
        }
        
        // Handle error responses
        if ('error' in message && message.error) {
          resolver.reject(createMcpError(
            message.error.message || 'Unknown error',
            message.error.code,
            message.error.data
          ));
        } 
        // Handle successful responses
        else if ('result' in message) {
          resolver.resolve(message.result);
        } 
        // Handle invalid responses
        else {
          resolver.reject(createMcpError(`Invalid JSON-RPC response received for ID ${id}`, -32603));
        }
        
        // Remove the request from the pending map
        clientState.pendingRequests.delete(id);
      } else {
        // We got a response for a request we don't know about
        console.warn(`Received response for unknown or timed out request ID ${id} from ${clientState.serverName}`);
      }
      return;
    }
    
    // If we got here, the message is neither a valid notification nor a valid response
    console.warn(`Received invalid message from ${clientState.serverName}:`, message);
  };
  
  // --- Main Manager Function ---
  
  export const manager = (
    config: ManagerConfig,
    options?: ManagerOptions
  ): ManagerAPI => {
    // Initialize the manager state
    let managerState = createInitialState(config, options);
    
    // Track pending connections
    const pendingConnections = new Map<string, Promise<void>>();
  
    // State management functions
    const updateManagerState = (newState: ManagerStateType): void => {
      managerState = newState;
    };
  
    const getManagerState = (): ManagerStateType => {
      return managerState;
    };
  
    // Connect to a server
    const connectToServer = async (serverName: string): Promise<ManagerStateType> => {
      // Skip if the server is already connected
      if (managerState.activeClients[serverName]) {
        return managerState;
      }
      
      // Check if we already have a pending connection
      if (pendingConnections.has(serverName)) {
        try {
          // Wait for the existing connection to complete
          await pendingConnections.get(serverName);
          return managerState;
        } catch (error) {
          // Previous connection attempt failed, try again
          pendingConnections.delete(serverName);
        }
      }
      
      // Create a new connection promise
      const connectionPromise = (async (): Promise<ManagerStateType> => {
        // Check if the server config exists
        const serverConfig = managerState.config[serverName];
        if (!serverConfig) {
          throw createMcpError(`Server configuration not found for "${serverName}"`);
        }
        
        // Initialize state
        const pendingRequests: PendingRequests = new Map();
        let transport: Transport | null = null;
        let intentionalDisconnect = false;
        
        // Define error handler
        const handleError = (error: Error): void => {
          console.error(`Error from ${serverName}:`, error);
          
          // Clean up if we have a transport
          if (transport) {
            transport.close().catch(closeErr => {
              console.error(`Error closing transport during error handling for ${serverName}:`, closeErr);
            });
          }
          
          // Update manager state to remove the client if it was added
          const currentState = getManagerState();
          if (currentState.activeClients[serverName]) {
            updateManagerState(removeClientFromState(currentState, serverName));
          }
        };
        
        // Define exit handler
        const handleExit = (code: number | null): void => {
          // If we're intentionally disconnecting, don't treat this as an error
          if (intentionalDisconnect) {
            console.log(`Server process ${serverName} terminated with code ${code ?? 'unknown'}`);
          } else if (code === 143 || code === 0) {
            // Code 143 is returned for SIGTERM on Windows/Bun
            console.log(`Server process ${serverName} exited with code ${code ?? 'unknown'}`);
          } else {
            // Only treat unexpected non-zero exit codes as errors
            console.warn(`Server process ${serverName} exited unexpectedly with code ${code ?? 'unknown'}`);
            handleError(createMcpError(`Server process ${serverName} exited with code ${code ?? 'unknown'}`));
          }
          
          // Always remove the client from the manager state
          const currentState = getManagerState();
          if (currentState.activeClients[serverName]) {
            updateManagerState(removeClientFromState(currentState, serverName));
          }
        };
        
        // Define message handler function
        const messageHandler = (message: JsonRpcMessage): void => {
          const currentState = getManagerState();
          const client = currentState.activeClients[serverName];
          
          if (client) {
            handleIncomingMessage(message, client, currentState.options.onNotification);
          } else if ('id' in message && message.id !== null) {
            // This is a response, so check if it's for a pending request
            const resolver = pendingRequests.get(message.id);
            if (resolver) {
              // Clear timeout
              if (resolver.timeoutTimer) {
                clearTimeout(resolver.timeoutTimer as number);
              }
              
              // Handle error or result
              if ('error' in message && message.error) {
                resolver.reject(createMcpError(
                  message.error.message || 'Unknown error',
                  message.error.code,
                  message.error.data
                ));
              } else if ('result' in message) {
                resolver.resolve(message.result);
              } else {
                resolver.reject(createMcpError(`Invalid JSON-RPC response received for ID ${message.id}`, -32603));
              }
              
              // Clean up
              pendingRequests.delete(message.id);
            } else {
              console.warn(`Received message from ${serverName} before client state was fully initialized. Discarding.`);
            }
          } else {
            console.warn(`Received message from ${serverName} before client state was fully initialized. Discarding.`);
          }
        };
        
        try {
          // Create the transport
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
          
          // Send initialize request
          const initRequest = createJsonRpcRequest('initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
          });
          
          // Send the request
          await transport.send(initRequest);
          
          // Create a timeout for initialization
          const initTimeoutMs = Math.min(managerState.options.requestTimeoutMs, 10000);
          const timeoutMessage = `Initialization timed out for ${serverName} after ${initTimeoutMs}ms`;
          
          // Create a promise for the initialization response
          const initResponsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
            // Set up a timeout
            const timeoutTimer = setTimeout(() => {
              pendingRequests.delete(initRequest.id);
              reject(createMcpError(timeoutMessage, -32000));
            }, initTimeoutMs);
            
            // Add to pending requests
            pendingRequests.set(initRequest.id, {
              resolve: resolve as (value: unknown) => void,
              reject,
              timeoutTimer,
            });
          });
          
          // Wait for the response
          const initResponse = await initResponsePromise;
          
          // Check for initialization errors
          if ('error' in initResponse && initResponse.error) {
            throw createMcpError(
              `Initialization failed for ${serverName}: ${initResponse.error.message}`,
              initResponse.error.code,
              initResponse.error.data
            );
          }
          
          // Extract server capabilities
          const resultObj = initResponse.result as { capabilities?: Record<string, unknown> } || {};
          const serverCapabilities = resultObj.capabilities ?? {};
          
          // Create the client API
          const clientApi = createClientApi(
            serverName,
            getManagerState,
            updateManagerState,
            transport,
            pendingRequests,
            serverCapabilities,
            (value: boolean) => { intentionalDisconnect = value; }
          );
          
          // Create the client state
          const clientState: ClientState = {
            serverName,
            config: serverConfig,
            transport,
            pendingRequests,
            capabilities: serverCapabilities,
            clientAPI: clientApi,
          };
          
          // Update manager state with the new client
          const nextState = addClientToState(getManagerState(), clientState);
          updateManagerState(nextState);
          
          // Send initialized notification (fire and forget)
          const initializedNotification: JsonRpcNotification = {
            jsonrpc: JSONRPC_VERSION,
            method: 'initialized',
            params: {},
          };
          
          await transport.send(initializedNotification);
          
          // At the end of the function, return the updated state
          return nextState;
        } catch (error) {
          // Clean up on error
          if (transport) {
            intentionalDisconnect = true;
            await transport.close().catch(closeErr => {
              console.error(`Error closing transport during init error for ${serverName}:`, closeErr);
            });
          }
          
          // Reject all pending requests
          pendingRequests.forEach((resolver) => {
            if (resolver.timeoutTimer) {
              clearTimeout(resolver.timeoutTimer as number);
            }
            resolver.reject(error);
          });
          
          // Clear pending requests
          pendingRequests.clear();
          
          // Re-throw the error
          throw error;
        }
      })();
      
      // Store the connection promise
      pendingConnections.set(serverName, connectionPromise.then(() => {}));
      
      try {
        // Wait for connection to complete and return the new state
        return await connectionPromise;
      } finally {
        // Clean up the pending connection
        pendingConnections.delete(serverName);
      }
    };
  
    // Use a server
    const useServer = async (serverName: string): Promise<ManagerAPI> => {
      try {
        // Connect to the server and get the updated state
        const updatedState = await connectToServer(serverName);
        
        // Create a completely new manager with the updated config (empty clients)
        const newManager = manager(updatedState.config, {
          onNotification: updatedState.options.onNotification,
          requestTimeoutMs: updatedState.options.requestTimeoutMs,
        });
        
        // Get the internals of the new manager
        const newManagerInternals = newManager._getState();
        
        // Only transfer the newly activated client
        const clientToTransfer = updatedState.activeClients[serverName];
        if (clientToTransfer) {
          newManagerInternals.updateState({
            ...newManagerInternals.state,
            activeClients: { 
              [serverName]: clientToTransfer 
            }
          });
        }
        
        // Return the new manager
        return newManager;
      } catch (error) {
        // Re-throw any errors
        throw error;
      }
    };
  
    // Get a client
    const getClient = (serverName: string): ClientAPI | undefined => {
      // Only return a client if it exists in the active clients map
      const clientState = managerState.activeClients[serverName];
      if (!clientState) {
        return undefined;
      }
      return clientState.clientAPI;
    };
  
    // Get a client asynchronously
    const getClientAsync = async (serverName: string): Promise<ClientAPI | undefined> => {
      // If there's a pending connection, wait for it
      if (pendingConnections.has(serverName)) {
        try {
          await pendingConnections.get(serverName);
        } catch (error) {
          console.error(`Error connecting to ${serverName}:`, error);
          return undefined;
        }
      }
      
      // Return the client if it exists
      return managerState.activeClients[serverName]?.clientAPI;
    };
  
    // Disconnect all clients
    const disconnectAll = async (): Promise<void> => {
      // Wait for all pending connections to complete or fail
      if (pendingConnections.size > 0) {
        await Promise.allSettled(Array.from(pendingConnections.values()));
      }
      
      // Get the list of active clients before starting to disconnect
      const clientsToDisconnect = Object.values(managerState.activeClients);
      
      // Disconnect all active clients
      const disconnectPromises = clientsToDisconnect.map(client => {
        return client.clientAPI.disconnect().catch(error => {
          console.error(`Error disconnecting client ${client.serverName}:`, error);
        });
      });
      
      // Wait for all disconnects to complete
      await Promise.all(disconnectPromises);
      
      // Force update the state to have no active clients
      // This ensures state is updated even if individual disconnect calls failed
      updateManagerState({
        ...managerState,
        activeClients: {}
      });
    };
  
    // Create the manager API
    const createManagerApi = (): ManagerAPI => {
      return Object.freeze({
        use: useServer,
        getClient,
        getClientAsync,
        disconnectAll,
        _getState: (): ManagerStateInternals => {
          const state = getManagerState();
          return {
            state,
            updateState: updateManagerState,
            // Add direct access to state properties
            config: state.config,
            options: state.options,
            activeClients: state.activeClients
          };
        },
      });
    };
  
    return createManagerApi();
  };
  
  // Export the manager function
  export const managerFunction = manager;