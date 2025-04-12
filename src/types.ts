import type { Subprocess } from 'bun';

// --- Configuration Types ---

export type StdioTransportConfig = Readonly<{
  type: 'stdio';
  command: string;
  args?: ReadonlyArray<string>;
  env?: Readonly<Record<string, string>>;
  cwd?: string;
}>;

export type SseTransportConfig = Readonly<{
  type: 'sse';
  url: string; // URL for SSE endpoint and POST requests
  headers?: Readonly<Record<string, string>>;
}>;

export type TransportConfig = StdioTransportConfig | SseTransportConfig;

export type ServerConfig = Readonly<{
  transport: TransportConfig;
  // Optional: Define capabilities client expects server to support
  requiredCapabilities?: Readonly<Record<string, unknown>>;
}>;

export type ManagerConfig = Readonly<Record<string, ServerConfig>>;

// --- Protocol & Communication Types ---

export type JsonRpcId = string | number;

export type JsonRpcRequest = Readonly<{
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}>;

export type JsonRpcNotification = Readonly<{
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}>;

export type JsonRpcError = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

export type JsonRpcResponse = Readonly<{
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}>;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// --- Callback Types ---

export type NotificationHandler = (
  serverName: string,
  notification: Readonly<Omit<JsonRpcNotification, 'jsonrpc'>>
) => void;

// --- Options ---

export type ManagerOptions = Readonly<{
  onNotification?: NotificationHandler;
  requestTimeoutMs?: number; // Timeout for individual requests
}>;

// --- MCP Entity Types ---

export type JsonSchema = Readonly<Record<string, unknown>>;

export type Tool = Readonly<{
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}>;

export type Resource = Readonly<{
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}>;

export type PromptArgument = Readonly<{
    name: string;
    description?: string;
    required?: boolean;
}>;

export type Prompt = Readonly<{
    name: string;
    description?: string;
    arguments?: ReadonlyArray<PromptArgument>;
}>;

// --- Client API ---

export type ClientAPI = Readonly<{
  /** Get the capabilities reported by the server during initialization. */
  getCapabilities: () => Readonly<Record<string, unknown>> | undefined;

  /** Call a tool on the server. */
  callTool: <TResult = unknown>(
    name: string,
    params: Readonly<Record<string, unknown>>
  ) => Promise<TResult>;

  /** List available tools on the server. */
  listTools: () => Promise<ReadonlyArray<Tool>>;

  /** Read the content of a resource from the server. */
  readResource: (uri: string) => Promise<string | Buffer>;

  /** List available resources on the server. */
  listResources: () => Promise<ReadonlyArray<Resource>>;

  /** List available prompts on the server. */
  listPrompts: () => Promise<ReadonlyArray<Prompt>>;

  /** Get the definition of a specific prompt. */
  getPrompt: (name: string, args?: Readonly<Record<string, unknown>>) => Promise<string>; // Or a structured prompt type

  /** Send a ping request to check connectivity. */
  ping: () => Promise<void>;

  /** Disconnect this specific client and terminate its server process/connection. */
  disconnect: () => Promise<void>;
}>;

// --- Manager API ---

export type ManagerStateInternals = {
  state: ManagerStateType;
  updateState: (newState: ManagerStateType) => void;
  // Add direct access to ManagerStateType properties for backwards compatibility
  config: ManagerConfig;
  options: Readonly<Required<ManagerOptions>>;
  activeClients: Readonly<Record<string, ClientState>>;
};

export type ManagerAPI = Readonly<{
  /** Connects to and initializes a server defined in the configuration. */
  use: (serverName: string) => Promise<ManagerAPI>; // Return Promise<ManagerAPI> to allow awaiting connection

  /** Retrieves the API for an already connected and initialized client. */
  getClient: (serverName: string) => ClientAPI | undefined;

  /** Retrieves the API for an already connected and initialized client, waiting for pending connections. */
  getClientAsync: (serverName: string) => Promise<ClientAPI | undefined>;

  /** Disconnects all managed clients and terminates their server processes/connections. */
  disconnectAll: () => Promise<void>;

  /** Returns the current immutable state of the manager (for debugging or advanced use). */
  _getState: () => ManagerStateInternals; // Updated return type
}>;

// --- Internal State Types ---

// Make this mutable to allow setting the timer after creation
export type RequestResolver = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutTimer: number | NodeJS.Timeout | null; // Support both number and Timeout object
};

// Using a mutable Map here is a pragmatic choice for performance and simplicity
// in a zero-dependency context. True immutability would require persistent structures.
export type PendingRequests = Map<JsonRpcId, RequestResolver>;

export type Transport = Readonly<{
  send: (message: JsonRpcRequest | JsonRpcNotification) => Promise<void>;
  close: () => Promise<void>;
  isClosed: () => boolean;
  // Internal details needed for cleanup
  _details: Readonly<{
    type: 'stdio' | 'sse';
    process?: Subprocess;
    // Use a more generic reference that works with both Bun's EventSource and DOM EventSource
    sseSource?: unknown;
    abortController?: AbortController;
  }>;
}>;

export type ClientState = Readonly<{
  serverName: string;
  config: ServerConfig;
  transport: Transport;
  pendingRequests: PendingRequests; // Mutable Map by design choice
  capabilities?: Readonly<Record<string, unknown>>;
  clientAPI: ClientAPI;
}>;

export type ManagerStateType = Readonly<{
  config: ManagerConfig;
  options: Readonly<Required<ManagerOptions>>; // Options with defaults applied
  activeClients: Readonly<Record<string, ClientState>>;
}>;