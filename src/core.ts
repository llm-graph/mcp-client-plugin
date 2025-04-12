import { DEFAULT_REQUEST_TIMEOUT_MS, JSONRPC_VERSION, MCP_PROTOCOL_VERSION, INIT_TIMEOUT_MAX_MS, API_METHODS } from './constants';
import { ManagerConfig, ManagerOptions, ManagerStateType, Transport, ClientAPI, ManagerAPI, PendingRequests, JsonRpcResponse, ManagerStateInternals, ClientState } from './types';
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
      try { await pendingConnections.get(serverName); return state; }
      catch { pendingConnections.delete(serverName); }
    }
    
    // If there's a pending disconnection, wait for it to complete first
    if (pendingDisconnections.has(serverName)) {
      try { await pendingDisconnections.get(serverName); }
      catch { /* Ignore disconnection errors */ }
    }
    
    const connectionPromise = (async (): Promise<ManagerStateType> => {
      const serverConfig = state.config[serverName];
      if (!serverConfig) throw createMcpError(`Server configuration not found: "${serverName}"`);
      
      const pendingRequests: PendingRequests = new Map();
      let transport: Transport | null = null;
      let clientStateInternals: ClientStateInternals | null = null;
      
      const cleanup = () => {
        if (transport) transport.close().catch(err => console.error(`Error closing transport:`, err));
        if (state.activeClients[serverName]) {
          const newActiveClients = { ...state.activeClients };
          delete newActiveClients[serverName];
          
          updateState({
            ...state,
            activeClients: newActiveClients
          });
        }
        
        pendingConnections.delete(serverName);
      };
      
      try {
        // Create handlers and transport
        const onError = (error: Error) => { 
          if (!clientStateInternals?.intentionalDisconnect) {
            log(LOG_LEVELS.ERROR, `Error from ${serverName}:`, error); 
            cleanup(); 
          }
        };
        
        const onExit = (code: number | null) => {
          const exitMsg = `Server process ${serverName} exited with code ${code ?? 'unknown'}`;
          if (clientStateInternals?.intentionalDisconnect || code === 0 || code === 143) {
            log(LOG_LEVELS.INFO, exitMsg);
          } else {
            log(LOG_LEVELS.WARN, `${exitMsg} (unexpected)`);
            onError(createMcpError(exitMsg));
          }
        };
        
        transport = await createTransport(
          serverName, serverConfig.transport,
          msg => handleMessage(msg, serverName, pendingRequests, state.options.onNotification),
          onError, onExit
        );
        
        // Initialize the server
        const initRequest = createJsonRpcRequest(API_METHODS.INITIALIZE, 
          { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} });
        await transport.send(initRequest);
        
        // Wait for initialization response
        const initTimeoutMs = Math.min(state.options.requestTimeoutMs, INIT_TIMEOUT_MAX_MS);
        const initPromise = new Promise<JsonRpcResponse>((resolve, reject) => {
          pendingRequests.set(initRequest.id, {
            resolve: resolve as (value: unknown) => void,
            reject, 
            timeoutTimer: null
          });
        });
        
        const initResponse = await promiseWithTimeout(
          initPromise,
          initTimeoutMs,
          `Initialization timed out after ${initTimeoutMs}ms`
        ).catch(err => {
          pendingRequests.delete(initRequest.id);
          throw err;
        });
        
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
          try {
            internals.setIntentionalDisconnect(true);
            log(LOG_LEVELS.INFO, `Disconnecting client ${serverName}`);
            await disconnectClient(serverName, state.activeClients[serverName], globalClientRegistry);
            pendingConnections.delete(serverName);
            pendingDisconnections.delete(serverName);
          } catch (err) {
            log(LOG_LEVELS.ERROR, `Error during disconnect for ${serverName}:`, err);
            throw err;
          }
        };
        
        // Add the disconnect method to the client API
        const clientAPIWithDisconnect = Object.freeze({
          ...clientApi,
          disconnect
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
        await transport.send({ jsonrpc: JSONRPC_VERSION, method: API_METHODS.INITIALIZED, params: {} });
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
      return managerAPI;
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
      // Use getClientApis to retrieve all APIs
      const clientApis = getClientApis(state.activeClients);
      
      // Disconnect each client
      const promises = clientApis.map(api => 
        api.disconnect()
          .catch(error => log(LOG_LEVELS.ERROR, `Failed to disconnect: ${error}`))
      );
      
      await Promise.all(promises);
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