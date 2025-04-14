import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { NOTIFICATION_METHODS } from '../../src/constants';
import type { ManagerAPI, LoggingLevel } from '../../src/types';

describe('Logging Level E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('sets logging level and receives appropriate log notifications', async () => {
    // Create a real server using the filesystem MCP server
    const config = {
      filesystemServer: {
        transport: {
          type: 'stdio' as const,
          command: 'bunx',
          args: ['@modelcontextprotocol/server-filesystem', '.']
        }
      }
    };
    
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
    managerInstance = await manager(config, { onNotification: notificationHandler }).use('filesystemServer');
    
    // Get the client
    const client = managerInstance.getClient('filesystemServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Set logging level to debug (most verbose)
      await client.setLoggingLevel('debug');
      
      // Perform some operations to generate logs
      await client.listResources();
      await client.listResourceTemplates();
      
      // Set logging level to error (least verbose)
      await client.setLoggingLevel('error');
      
      // Perform more operations
      await client.listResources();
      
      // Wait a bit for any async logs to arrive
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify we received some log messages
      expect(logMessages.length).toBeGreaterThan(0);
      
      // Should have different log levels
      const debugLogs = logMessages.filter(log => log.level === 'debug');
      
      // Filesystem server should produce at least some debug logs
      // when level is set to debug
      expect(debugLogs.length).toBeGreaterThan(0);
    }
  });
}); 