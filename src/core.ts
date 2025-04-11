import type {
    ManagerConfig,
    ManagerOptions,
    ManagerAPI,
    ManagerStateType,
    ClientState,
    Transport,
    ServerConfig,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcMessage,
    JsonRpcId,
    PendingRequests,
    ClientAPI,
    StdioTransportConfig,
    SseTransportConfig,
    NotificationHandler,
    Tool,
    Resource,
    Prompt,
    JsonRpcNotification,
  } from './types';
  import {
    DEFAULT_REQUEST_TIMEOUT_MS,
    JSONRPC_VERSION,
    MCP_PROTOCOL_VERSION
  } from './constants';
  import {
    generateId,
    safeJsonParse,
    createJsonRpcRequest,
    createMcpError,
    promiseWithTimeout,
    processStdioBuffer,
    createJsonRpcNotification
  } from './utils';
  import type { Subprocess } from 'bun';
  
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
                    stdoutBuffer = processStdioBuffer(value, stdoutBuffer, handleMessage, handleError);
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
                    stderrBuffer += value.toString('utf8');
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
               await Bun.write(proc.stdin, line);
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
                if (!proc.stdin.closed) {
                    await proc.stdin.end();
                }
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
            // Assuming global for now, adjust if needed.
            eventSource = new EventSource(config.url, {
                headers: config.headers,
                // Consider adding withCredentials if needed, though less common for MCP
            });
  
            eventSource.onmessage = (event) => {
                const message = safeJsonParse(event.data);
                if (message) {
                    handleMessage(message);
                } else {
                    handleError(createMcpError(`Received invalid JSON via SSE from ${serverName}: ${event.data.substring(0,100)}...`));
                }
            };
  
            eventSource.onerror = (event) => {
                // Differentiate between connection errors and other SSE errors if possible
                const errorMessage = event.message ?? `SSE error for ${serverName}`;
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
  
        const timeoutMessage = `Request timed out after ${options.requestTimeoutMs}ms: ${serverName} -> ${method}`;
        const { P, timer } = promiseWithTimeout(
            new Promise<TResult>((res, rej) => {
                // Store resolvers *before* sending the request
                pendingRequests.set(id, { resolve: res as (value: unknown) => void, reject: rej, timeoutTimer: timer });
            }),
            options.requestTimeoutMs,
            timeoutMessage
        );
  
        // Attach cleanup to the final promise resolution/rejection
        P.finally(() => {
            clearTimeout(timer); // Ensure timer is cleared regardless of outcome
            pendingRequests.delete(id);
        }).catch(finalRejectionError => {
            // This catch is primarily for the timeout error or transport errors during send
            // Errors from the server response are handled via the stored reject handler
             if (!pendingRequests.has(id)) {
                 // If the request was already resolved/rejected (e.g., by server response before timeout)
                 // then the error here is likely the timeout itself or a send error, reject the outer promise
                 reject(finalRejectionError);
             }
             // If pendingRequests still has the ID, it means the reject handler stored in the map
             // will handle the rejection when the server responds with an error.
        });
  
  
        transport.send(request).catch(sendError => {
              // If sending fails immediately, reject the promise
              const resolver = pendingRequests.get(id);
              if (resolver) {
                  clearTimeout(resolver.timeoutTimer);
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
        clientToRemove.pendingRequests.forEach((resolver, id) => {
            clearTimeout(resolver.timeoutTimer);
            resolver.reject(createMcpError(`Client ${serverName} disconnected while request ${id} was pending.`));
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
        clearTimeout(resolver.timeoutTimer); // Clear timeout now that response received
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
  
  export const manager = async (
    config: ManagerConfig,
    options?: ManagerOptions
  ): Promise<ManagerAPI> => {
  
    // Use a mutable variable within this scope to hold the *current* state reference.
    // Functions created within this scope will close over this `let` variable.
    // Updates happen by assigning a new immutable state object to this variable.
    let managerState: ManagerStateType = createInitialState(config, options);
  
    const updateManagerState = (newState: ManagerStateType): void => {
        managerState = newState;
    };
  
    const getManagerState = (): ManagerStateType => {
        return managerState;
    };
  
    const useServer = async (serverName: string): Promise<ManagerAPI> => {
      if (managerState.activeClients[serverName]) {
        // Already active, return the current API object
        return createManagerApi(getManagerState, updateManagerState);
      }
  
      const serverConfig = managerState.config[serverName];
      if (!serverConfig) {
        throw createMcpError(`Server configuration not found for "${serverName}"`);
      }
  
      const pendingRequests: PendingRequests = new Map();
  
      // Temporary state holder while initializing
      let transport: Transport | null = null;
      let clientStateRef: { current: ClientState } | null = null; // Ref needed for closures
  
      const handleError = (error: Error): void => {
          console.error(`Error from ${serverName}:`, error);
          // Potentially trigger disconnect or notify user
          if (clientStateRef?.current) {
             // If client is already partially/fully initialized, try to disconnect it
             clientStateRef.current.clientAPI.disconnect().catch(disconnectErr => console.error(`Error during auto-disconnect of ${serverName}:`, disconnectErr));
          } else if (transport) {
             // If only transport exists, close it
             transport.close().catch(closeErr => console.error(`Error closing transport during error handling for ${serverName}:`, closeErr));
          }
          // Remove the client if it was added prematurely or partially
          updateManagerState(removeClientFromState(getManagerState(), serverName));
      };
  
      const handleExit = (code: number | null): void => {
          console.warn(`Server process ${serverName} exited with code ${code ?? 'unknown'}.`);
          handleError(createMcpError(`Server process ${serverName} exited unexpectedly.`)); // Treat exit as an error requiring cleanup
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
              transport = await createStdioTransport(serverName, serverConfig.transport, messageHandler, handleError, handleExit);
          } else if (serverConfig.transport.type === 'sse') {
              transport = await createSseTransport(serverName, serverConfig.transport, messageHandler, handleError);
          } else {
              throw createMcpError(`Unsupported transport type for server ${serverName}`);
          }
  
          // Initialize: Send 'initialize' request
          const initRequest = createJsonRpcRequest('initialize', {
               protocolVersion: MCP_PROTOCOL_VERSION,
               capabilities: {}, // Client capabilities can be added here
          });
  
          const initPromise = new Promise<JsonRpcResponse>((resolve, reject) => {
               const timeoutMessage = `Initialization timed out for ${serverName} after ${managerState.options.requestTimeoutMs}ms`;
               const { P, timer } = promiseWithTimeout(
                  new Promise<JsonRpcResponse>((res, rej) => {
                      pendingRequests.set(initRequest.id, { resolve: res as (value: unknown) => void, reject: rej, timeoutTimer: timer });
                  }),
                  managerState.options.requestTimeoutMs,
                  timeoutMessage
               );
               P.then(resolve).catch(reject).finally(() => {
                  clearTimeout(timer);
                  pendingRequests.delete(initRequest.id);
               });
          });
  
          await transport.send(initRequest);
          const initResponse = await initPromise; // Wait for the initialize response
  
          if (initResponse.error) {
              throw createMcpError(`Initialization failed for ${serverName}: ${initResponse.error.message}`, initResponse.error.code, initResponse.error.data);
          }
  
          const serverCapabilities = (initResponse.result as { capabilities?: Record<string, unknown> })?.capabilities ?? {};
  
          // Create Client State and API (after successful initialize)
          // Must create the ref *before* creating the API that closes over it
          const tempClientState: Omit<ClientState, 'clientAPI'> = {
              serverName,
              config: serverConfig,
              transport: transport,
              pendingRequests,
              capabilities: serverCapabilities,
          };
          clientStateRef = { current: null as any }; // Initialize ref
           // Assign partially built state, then create API
          clientStateRef.current = { ...tempClientState, clientAPI: null as any };
          const clientApi = createClientApi(getManagerState, updateManagerState, clientStateRef);
          // Complete the ClientState with the created API
          const finalClientState: ClientState = { ...tempClientState, clientAPI: clientApi };
          clientStateRef.current = finalClientState; // Update ref with complete state
  
          // Send 'initialized' notification (fire and forget)
          await transport.send(createJsonRpcRequest('initialized', {}) as JsonRpcNotification); // Cast needed as ID is omitted for notifications
  
          // Update Manager State Immutably
          updateManagerState(addClientToState(getManagerState(), finalClientState));
  
          // Return the new ManagerAPI
          return createManagerApi(getManagerState, updateManagerState);
  
      } catch (error) {
          // Cleanup transport if created before error occurred
          if (transport) {
              await transport.close().catch(closeErr => console.error(`Error closing transport during init error for ${serverName}:`, closeErr));
          }
          // Reject any remaining pending requests (e.g., if transport send failed after storing resolver)
          pendingRequests.forEach((resolver, id) => {
              clearTimeout(resolver.timeoutTimer);
              resolver.reject(error); // Reject with the initialization error
          });
          console.error(`Failed to initialize server ${serverName}:`, error);
          throw error; // Re-throw the error after cleanup attempts
      }
    };
  
    const getClient = (serverName: string): ClientAPI | undefined => {
      return managerState.activeClients[serverName]?.clientAPI;
    };
  
    const disconnectAll = async (): Promise<void> => {
      const currentClients = Object.values(managerState.activeClients); // Get clients from current state
      const disconnectPromises = currentClients.map(client =>
          client.clientAPI.disconnect().catch(err => {
              // Log error but continue disconnecting others
              console.error(`Error disconnecting client ${client.serverName}:`, err);
          })
      );
      await Promise.all(disconnectPromises);
      // State should be updated by individual disconnect calls
    };
  
    // Function to create the manager API object, closing over the state accessors
    const createManagerApi = (
        getState: () => ManagerStateType,
        updateState: (newState: ManagerStateType) => void
    ): ManagerAPI => {
        return Object.freeze({
            use: useServer, // Note: useServer itself uses getState/updateState from the outer scope
            getClient: getClient, // getClient uses getState from the outer scope
            disconnectAll: disconnectAll, // disconnectAll uses getState from the outer scope
            _getState: getState // Expose state getter
        });
    };
  
    // Return the initial API object
    return createManagerApi(getManagerState, updateManagerState);
  };