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
  CALL_TOOL: 'tools/call',
  LIST_TOOLS: 'tools/list',
  READ_RESOURCE: 'resources/read',
  LIST_RESOURCES: 'resources/list',
  LIST_PROMPTS: 'prompts/list',
  GET_PROMPT: 'prompts/get',
  LIST_RESOURCE_TEMPLATES: 'resources/templates/list',
  COMPLETE: 'complete',
  SET_LOGGING_LEVEL: '$/logging/level'
} as const;

// Error codes
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000 // -32000 to -32099 reserved for server errors
} as const;

// Notification methods
export const NOTIFICATION_METHODS = {
  PROGRESS: '$/progress',
  LOGGING_MESSAGE: 'notifications/message'
} as const;