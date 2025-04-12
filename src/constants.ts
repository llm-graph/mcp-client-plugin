export const JSONRPC_VERSION = "2.0" as const;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000 as const; // 30 seconds
export const MCP_PROTOCOL_VERSION = "1.0" as const; // Specify the targeted MCP version

// Connection timeouts
export const SSE_CONNECTION_TIMEOUT_MS = 5000 as const;
export const INIT_TIMEOUT_MAX_MS = 10000 as const;
export const PROCESS_TERMINATION_TIMEOUT_MS = 1000 as const;

// Process exit codes
export const EXIT_CODE_SUCCESS = 0 as const;
export const EXIT_CODE_SIGTERM = 143 as const; // Common exit code when process is terminated with SIGTERM

// API Method constants
export const API_METHODS = {
  INITIALIZE: 'initialize',
  INITIALIZED: 'initialized',
  PING: 'ping',
  CALL_TOOL: 'call_tool',
  LIST_TOOLS: 'list_tools',
  READ_RESOURCE: 'read_resource',
  LIST_RESOURCES: 'list_resources',
  LIST_PROMPTS: 'prompts/list',
  GET_PROMPT: 'prompts/get'
} as const;