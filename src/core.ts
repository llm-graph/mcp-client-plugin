import { DEFAULT_REQUEST_TIMEOUT_MS, JSONRPC_VERSION, MCP_PROTOCOL_VERSION, INIT_TIMEOUT_MAX_MS, API_METHODS, NOTIFICATION_METHODS } from './constants';
import { ManagerConfig, ManagerOptions, ManagerStateType, Transport, ClientAPI, ManagerAPI, PendingRequests, JsonRpcResponse, ManagerStateInternals, ClientState, JsonRpcId, Progress, NotificationHandler } from './types';
import { createMcpError, promiseWithTimeout, log, LOG_LEVELS, ManagerRegistryEntry, createJsonRpcRequest, createTransport, handleMessage, createClientApi, ClientStateInternals, disconnectClient } from './utils';

// Global counter for manager instance IDs
let managerIdCounter = 0;

// Global client registry for tracking disconnects across manager instances
const globalClientRegistry = new Map<string, ManagerRegistryEntry[]>();

// Helper function to get client API objects
const getClientApis = (activeClients: ManagerStateType['activeClients']): ClientAPI[] => {
  return Object.values(activeClients)
    .filter((client): client is ClientState => 
      client !== undefined && 'clientAPI' in client
    )
    .map(client => client.clientAPI);
};

// Core functionality for managing MCP (Model Control Protocol) servers
export const manager = (config: ManagerConfig, options?: ManagerOptions): ManagerAPI => {
  // Each manager instance gets a unique ID
  const managerId = managerIdCounter++;
  
  // Each manager has its own independent state instance
  let state: ManagerStateType = {
    config: { ...config }, // Copy to avoid external mutation
    options: {
      onNotification: options?.onNotification ?? (() => {}),
      requestTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
    activeClients: {}, // This manager's active clients
  };
  
  // Per-manager connection tracking 
  const pendingConnections = new Map<string, Promise<void>>();
  const pendingDisconnections = new Map<string, Promise<void>>();
  
  // Update state immutably
  const updateState = (newState: ManagerStateType): void => { 
    state = { ...newState }; 
  };
  
  // Register this manager in the global registry
  const registerInGlobalRegistry = (serverName: string) => {
    if (!globalClientRegistry.has(serverName)) {
      globalClientRegistry.set(serverName, []);
    }
    
    const managers = globalClientRegistry.get(serverName)!;
    // Only add this manager if it's not already registered
    if (!managers.some(entry => entry.id === managerId)) {
      managers.push({ id: managerId, updateState, state });
    }
  };
  
  // Connect to server
  const connectToServer = async (serverName: string): Promise<ManagerStateType> => {
    // Return existing connection or wait for pending connection
    if (state.activeClients[serverName]) return state;
    
    // If there's a pending connection, wait for it
    if (pendingConnections.has(serverName)) {
      try { 
        await pendingConnections.get(serverName); 
        // After waiting, verify the client is actually in state
        // as it might have been disconnected by another process
        return state.activeClients[serverName] ? state : connectToServer(serverName);
      }
      catch (err) { 
        pendingConnections.delete(serverName);
        // Re-attempt connection if it failed
        return connectToServer(serverName);
      }
    }
    
    // If there's a pending disconnection, wait for it to complete first
    if (pendingDisconnections.has(serverName)) {
      try { 
        await pendingDisconnections.get(serverName);
        // Ensure we have a clean slate after disconnection 
        pendingDisconnections.delete(serverName);
      }
      catch (err) { 
        // Disconnection failed - clean up tracking
        pendingDisconnections.delete(serverName);
        log(LOG_LEVELS.WARN, `Ignoring failed disconnection for ${serverName} before connecting: ${err}`);
      }
    }
    
    const connectionPromise = (async (): Promise<ManagerStateType> => {
      // Get latest config for server (it might have changed)
      const serverConfig = state.config[serverName];
      if (!serverConfig) throw createMcpError(`Server configuration not found: "${serverName}"`);
      
      const pendingRequests: PendingRequests = new Map();
      let transport: Transport | null = null;
      let clientStateInternals: ClientStateInternals | null = null;
      
      const cleanup = () => {
        if (transport) transport.close().catch(err => console.error(`Error closing transport:`, err));
        if (state.activeClients[serverName]) {
          // Create a new state with this client removed
          updateState({
            ...state,
            activeClients: Object.entries(state.activeClients)
              .filter(([name]) => name !== serverName)
              .reduce((acc, [name, client]) => ({ ...acc, [name]: client }), {})
          });
        }
        
        pendingConnections.delete(serverName);
      };
      
      try {
        // Create a custom notification handler for this specific client
        // that wraps the global handler but adds special handling for progress notifications
        const handleClientNotification: NotificationHandler = (clientName: string, notification) => {
          // Let the global handler process all notifications
          if (state.options.onNotification) {
            state.options.onNotification(clientName, notification);
          }
          
          // Special handling for progress notifications to route them to specific requests
          if (notification.method === NOTIFICATION_METHODS.PROGRESS && notification.params) {
            const progressParams = notification.params as unknown as { 
              requestId: JsonRpcId;
              progress: Progress;
            };
            
            if (progressParams.requestId && pendingRequests.has(progressParams.requestId)) {
              const resolver = pendingRequests.get(progressParams.requestId);
              if (resolver?.onProgress && progressParams.progress) {
                resolver.onProgress(progressParams.progress);
              }
            }
          }
        };
        
        // Create handlers and transport
        const onError = (error: Error) => { 
          if (!clientStateInternals?.intentionalDisconnect) {
            log(LOG_LEVELS.ERROR, `Error from ${serverName}:`, error); 
            cleanup(); 
          }
        };
        
        const onExit = (code: number | null) => {
          // On Windows, null exit code often means normal termination
          const normalizedCode = code === null && process.platform === 'win32' ? 0 : code;
          const exitMsg = `Server process ${serverName} exited with code ${normalizedCode ?? 'unknown'}`;
          
          // Only log unexpected exits at higher levels
          if (clientStateInternals?.intentionalDisconnect || 
              normalizedCode === 0 || normalizedCode === 1 || normalizedCode === 143 || 
              (normalizedCode === null && process.platform === 'win32')) {
            // Intentional disconnect or normal exit, log at debug level
            log(LOG_LEVELS.DEBUG, exitMsg);
          } else {
            // Unexpected exit, log at warning level
            log(LOG_LEVELS.WARN, `${exitMsg} (unexpected)`);
            // Only report errors for truly unexpected exits
            if (normalizedCode !== null && normalizedCode > 1 && normalizedCode !== 143) {
              onError(createMcpError(exitMsg));
            }
          }
        };
        
        transport = await createTransport(
          serverName, serverConfig.transport,
          msg => handleMessage(msg, serverName, pendingRequests, handleClientNotification),
          onError, onExit
        );
        
        // Initialize the server with retry logic
        const maxRetries = serverConfig.transport.type === 'stdio' && 
                         serverConfig.transport.options?.initializationRetries ? 
                         serverConfig.transport.options.initializationRetries : 2;
        const retryDelayMs = serverConfig.transport.type === 'stdio' && 
                           serverConfig.transport.options?.initializationRetryDelay ? 
                           serverConfig.transport.options.initializationRetryDelay : 500;
                           
        let initResponse: JsonRpcResponse | null = null;
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 0) {
              log(LOG_LEVELS.INFO, `Retrying initialization for ${serverName} (${attempt}/${maxRetries})`);
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
            
            const initRequest = createJsonRpcRequest(API_METHODS.INITIALIZE, { 
              protocolVersion: MCP_PROTOCOL_VERSION, 
              clientInfo: {
                name: "mcp-client-plugin",
                version: "0.1.0"
              },
              capabilities: {} 
            });
            await transport.send(initRequest);

            // Wait for initialization response
            const initTimeoutMs = Math.min(state.options.requestTimeoutMs, INIT_TIMEOUT_MAX_MS);
            const initPromise = new Promise<JsonRpcResponse>((resolve, reject) => {
              const timeoutTimer = setTimeout(() => {
                pendingRequests.delete(initRequest.id);
                reject(createMcpError(`Initialization timed out after ${initTimeoutMs}ms`));
              }, initTimeoutMs);
              
              pendingRequests.set(initRequest.id, {
                resolve: resolve as (value: unknown) => void,
                reject, 
                timeoutTimer
              });
            });

            initResponse = await promiseWithTimeout(
              initPromise,
              initTimeoutMs,
              () => pendingRequests.delete(initRequest.id),
              `Initialization timed out after ${initTimeoutMs}ms`
            );
            
            // If we get here, initialization succeeded
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            
            // Only log attempts if not the final one
            if (attempt < maxRetries) {
              log(LOG_LEVELS.WARN, `Initialization attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);
            }
            // Clear any pending requests from this attempt
            pendingRequests.forEach((resolver, id) => {
              clearTimeout(resolver.timeoutTimer as number);
              pendingRequests.delete(id);
            });
            
            // On last attempt, rethrow
            if (attempt === maxRetries) {
              throw lastError;
            }
          }
        }

        if (!initResponse) {
          throw lastError || createMcpError(`Failed to initialize ${serverName}`);
        }

        if ('error' in initResponse && initResponse.error) {
          throw createMcpError(`Initialization failed: ${initResponse.error.message}`, 
            initResponse.error.code, initResponse.error.data);
        }

        // Setup client 
        const capabilities = (initResponse.result as { capabilities?: Record<string, unknown> } || {}).capabilities ?? {};
        
        // Create the client API
        const [clientApi, internals] = createClientApi(
          serverName, transport, pendingRequests, capabilities, 
          state
        );
        
        clientStateInternals = internals;
        
        // Handle client disconnection - implement the disconnect method
        const disconnect = async (): Promise<void> => {
          // Check if we're already disconnecting
          if (pendingDisconnections.has(serverName)) {
            return pendingDisconnections.get(serverName);
          }
          
          const disconnectionPromise = (async (): Promise<void> => {
            try {
              // Mark this disconnection as intentional
              internals.setIntentionalDisconnect(true);
              log(LOG_LEVELS.INFO, `Disconnecting client ${serverName}`);
              
              // Disconnect the client using the helper function
              await disconnectClient(serverName, state.activeClients[serverName], globalClientRegistry);
              
              // Clean up tracking references
              pendingConnections.delete(serverName);
            } catch (err) {
              const formattedError = err instanceof Error ? err : new Error(String(err));
              log(LOG_LEVELS.ERROR, `Error during disconnect for ${serverName}: ${formattedError.message}`);
              throw formattedError;
            } finally {
              // Always clean up pending disconnection tracking
              pendingDisconnections.delete(serverName);
            }
          })();
          
          // Register this promise for tracking
          pendingDisconnections.set(serverName, disconnectionPromise);
          return disconnectionPromise;
        };
        
        // Add the disconnect method to the client API
        const clientAPIWithDisconnect = Object.freeze({
          ...clientApi,
          disconnect,
          getIntentionalDisconnect: clientApi.getIntentionalDisconnect
        });
        
        // Create a new active clients map to avoid shared references
        const newActiveClients = { ...state.activeClients };
        newActiveClients[serverName] = {
          serverName, 
          config: serverConfig, 
          transport, 
          pendingRequests,
          capabilities, 
          clientAPI: clientAPIWithDisconnect,
        };
        
        updateState({
          ...state,
          activeClients: newActiveClients
        });
        
        // Register this manager in the global registry
        registerInGlobalRegistry(serverName);
        
        // Complete initialization
        // Check if the server supports 'initialized' notification by treating errors as non-fatal
        try {
          await transport.send(createJsonRpcRequest(API_METHODS.INITIALIZED, {}));
        } catch (err) {
          // If the server rejects the 'initialized' notification, log but continue
          log(LOG_LEVELS.WARN, `Server ${serverName} does not support 'initialized' notification: ${err}`);
        }
        return state;
      } catch (err) {
        // Cleanup on error
        if (clientStateInternals) clientStateInternals.setIntentionalDisconnect(true);
        pendingRequests.forEach(resolver => {
          if (resolver.timeoutTimer) clearTimeout(resolver.timeoutTimer as number);
          resolver.reject(err);
        });
        
        pendingRequests.clear();
        cleanup();
        throw err;
      }
    })();
    
    pendingConnections.set(serverName, connectionPromise.then(() => {}));
    
    try { 
      return await connectionPromise; 
    } catch (err) {
      pendingConnections.delete(serverName);
      throw err;
    }
  };

  // Create the public manager API
  const managerAPI: ManagerAPI = Object.freeze({
    use: async (serverName: string): Promise<ManagerAPI> => {
      // Regular connection flow without special test cases
      await connectToServer(serverName);
      
      // Create a new manager API instance
      return Object.freeze({
        use: managerAPI.use,
        getClient: managerAPI.getClient,
        getClientAsync: managerAPI.getClientAsync,
        disconnectAll: managerAPI.disconnectAll,
        _getState: managerAPI._getState
      });
    },
    
    getClient: (serverName: string): ClientAPI | undefined => {
      return state.activeClients[serverName]?.clientAPI;
    },
    
    getClientAsync: async (serverName: string): Promise<ClientAPI | undefined> => {
      if (state.activeClients[serverName]) {
        return state.activeClients[serverName].clientAPI;
      }
      
      if (pendingConnections.has(serverName)) {
        try {
          await pendingConnections.get(serverName);
          const client = state.activeClients[serverName] as ClientState | undefined;
          return client?.clientAPI;
        } catch {
          return undefined;
        }
      }
      
      return undefined;
    },
    
    disconnectAll: async (): Promise<void> => {
      // Use getClientApis to retrieve all APIs and capture server names
      const activeClientEntries = Object.entries(state.activeClients);
      
      // No clients? Nothing to do
      if (activeClientEntries.length === 0) {
        return;
      }
      
      // Collect errors with server names for better reporting
      const disconnectionErrors: Array<{serverName: string; error: Error}> = [];
      
      // Disconnect each client and track their server names
      const disconnectionPromises = activeClientEntries.map(([serverName, clientState]) => 
        clientState.clientAPI.disconnect()
          .catch(error => {
            const formattedError = error instanceof Error ? error : new Error(String(error));
            // Don't log individual errors here to reduce noise, collect them instead
            disconnectionErrors.push({
              serverName,
              error: formattedError
            });
            // Resolve to ensure Promise.all completes
            return Promise.resolve();
          })
      );
      
      // Wait for all disconnect operations to complete
      await Promise.all(disconnectionPromises);
      
      // Ensure all clients are removed from state, even those that failed to disconnect properly
      if (Object.keys(state.activeClients).length > 0) {
        updateState({
          ...state,
          activeClients: {} // Create empty activeClients map (immutable approach)
        });
      }
      
      // Log consolidated error information only if there were errors
      if (disconnectionErrors.length > 0) {
        // Use a lower log level for expected disconnection errors
        log(
          LOG_LEVELS.INFO,
          `Disconnection completed with ${disconnectionErrors.length} error(s): ${
            disconnectionErrors.map(e => `${e.serverName}`).join(', ')
          }`
        );
      }
    },
    
    _getState: (): ManagerStateInternals => ({
      state,
      updateState,
      config: state.config,
      options: state.options,
      activeClients: state.activeClients
    })
  });
  
  // Return the manager API
  return managerAPI;
};

export const managerFunction = manager;