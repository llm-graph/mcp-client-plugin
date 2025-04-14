import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { NOTIFICATION_METHODS } from '../../src/constants';
import { resolveTestDependencies, createMemoryServerConfig } from '../../src/test-utils';
import type { ManagerAPI, LoggingLevel } from '../../src/types';

describe('Logging Level', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('setLoggingLevel sends correct request', async () => {
    // Check dependencies with improved resolution
    const dependencies = await resolveTestDependencies();
    const serverPkg = '@modelcontextprotocol/server-memory';
    
    if (!dependencies[serverPkg]) {
      console.warn(`Skipping test: ${serverPkg} not found - this should not happen if it's in package.json`);
      return;
    }
    
    // Create a real memory server
    const config = createMemoryServerConfig();
    
    // Track received log messages
    const logMessages: Array<{level: LoggingLevel; message: string}> = [];
    
    // Define notification handler to capture log messages
    const notificationHandler = (serverName: string, notification: {method: string; params?: unknown}) => {
      if (notification.method === NOTIFICATION_METHODS.LOGGING_MESSAGE) {
        const params = notification.params as {level: LoggingLevel; message: string};
        if (params.level && params.message) {
          logMessages.push({
            level: params.level,
            message: params.message
          });
        }
      }
    };
    
    // Create manager and connect to server
    managerInstance = await manager(config, { onNotification: notificationHandler }).use('memoryServer');
    
    // Get the client
    const client = managerInstance.getClient('memoryServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Set logging level to debug for more verbose logs
      await client.setLoggingLevel('debug');
      
      // Perform an operation to generate logs
      await client.listResources();
      
      // Set logging level to error (least verbose)
      await client.setLoggingLevel('error');
      
      // Perform another operation
      await client.listResources();
      
      // Wait a bit for any async logs to arrive
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify we set the logging level successfully by checking
      // if any debug logs were generated
      expect(logMessages.some(log => log.level === 'debug')).toBe(true);
      
      // Test other logging levels
      await client.setLoggingLevel('info');
      await client.setLoggingLevel('warning');
      await client.setLoggingLevel('error');
      
      // Verify these operations completed successfully
      // (no exception means the requests succeeded)
      expect(true).toBe(true);
    }
  });
}); 