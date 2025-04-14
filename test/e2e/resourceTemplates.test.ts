import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { ResourceTemplate } from '../../src/types';
import type { ManagerAPI } from '../../src/types';

describe('Resource Templates E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('lists resource templates from a server', async () => {
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
    
    // Notifications for debugging
    const notifications: Array<{serverName: string; method: string; params?: unknown}> = [];
    const notificationHandler = (serverName: string, notification: {method: string; params?: unknown}) => {
      notifications.push({serverName, ...notification});
    };
    
    // Create manager and connect to server
    managerInstance = await manager(config, { onNotification: notificationHandler }).use('filesystemServer');
    
    // Verify we connected successfully
    expect(managerInstance).toBeDefined();
    
    // Get the client
    const client = managerInstance.getClient('filesystemServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Get resource templates - filesystem server typically exposes at least one template
      const templates = await client.listResourceTemplates();
      
      // Verify the response structure
      expect(Array.isArray(templates)).toBe(true);
      
      // Each template should match the expected structure
      for (const template of templates) {
        expect(template).toHaveProperty('uriTemplate');
        expect(template).toHaveProperty('name');
        expect(typeof template.uriTemplate).toBe('string');
        expect(typeof template.name).toBe('string');
      }
    }
  });
}); 