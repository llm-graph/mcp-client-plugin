import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { resolveTestDependencies, createFilesystemServerConfig } from '../../src/test-utils';
import type { ManagerAPI } from '../../src/types';

describe('Resource Templates', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('listResourceTemplates returns resource templates', async () => {
    // Check dependencies with improved resolution
    const dependencies = await resolveTestDependencies();
    const serverPkg = '@modelcontextprotocol/server-filesystem';
    
    if (!dependencies[serverPkg]) {
      console.warn(`Skipping test: ${serverPkg} not found - this should not happen if it's in package.json`);
      return;
    }
    
    // Create a real filesystem server pointing to the current directory
    const config = createFilesystemServerConfig('.');
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('filesystemServer');
    
    // Get the client API
    const client = managerInstance.getClient('filesystemServer');
    expect(client).toBeDefined();
    
    if (client) {
      // List resource templates
      const templates = await client.listResourceTemplates();
      
      // Verify the response is an array
      expect(Array.isArray(templates)).toBe(true);
      
      // Each template should have the required properties
      for (const template of templates) {
        expect(template).toHaveProperty('uriTemplate');
        expect(template).toHaveProperty('name');
        expect(typeof template.uriTemplate).toBe('string');
        expect(typeof template.name).toBe('string');
      }
    }
  });
}); 