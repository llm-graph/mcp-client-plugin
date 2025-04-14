export { manager } from './core';
export { 
  JSONRPC_VERSION, 
  DEFAULT_REQUEST_TIMEOUT_MS, 
  MCP_PROTOCOL_VERSION 
} from './constants';

export {
  createMcpServerWrapper,
  enableMcpDebugging,
  LOG_LEVELS
} from './utils';

// Export test utilities
export {
  SERVER_PACKAGES,
  findServerPackage,
  createTestServerConfig,
  createTestEnvironment,
  getPackageRunnerCommand,
  extractCalculatorText,
  assertCalculatorResult
} from './test-utils';

export type {
  // Configuration Types
  StdioTransportConfig,
  SseTransportConfig,
  TransportConfig,
  ServerConfig,
  ManagerConfig,
  ManagerOptions,
  
  // API Types
  ManagerAPI,
  ClientAPI,
  
  // Entity Types
  Tool,
  Resource,
  Prompt,
  PromptArgument,
  
  // Callback Types
  NotificationHandler,
  
  // JSON-RPC Types
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcId
} from './types'; 

// Export compatibility types
export type {
  EventSourceCompatible,
  ReaderCompatible
} from './types'; 

export type {
  PackageRunner,
  CalculatorToolResponse
} from './test-utils'; 