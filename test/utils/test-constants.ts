import { API_METHODS } from '../../src/constants';

// Test-related constants
export const TEST_SERVER_NAMES = {
  ECHO_SERVER: "echoServer",
  TOOLS_SERVER: "toolsServer",
  RESOURCES_SERVER: "resourcesServer",
  SERVER1: "server1",
  SERVER2: "server2", 
  SERVER3: "server3"
} as const;

// Methods that should throw errors when accessed through shared managers
export const ERROR_THROWING_METHODS = [
  API_METHODS.LIST_PROMPTS,
  API_METHODS.GET_PROMPT
] as const;

// Test utility to determine if a method should throw errors
export const shouldThrowMethodError = (method: string): boolean => {
  return ERROR_THROWING_METHODS.includes(method as any);
}; 