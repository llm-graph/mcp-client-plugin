import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import type { ManagerAPI } from '../../src/types';

describe('Read Resource E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('reads resources with proper structure including multiple resources', async () => {
    // Create a real-world filesystem server that can read resources
    const config = {
      filesystemServer: {
        transport: {
          type: 'stdio' as const,
          command: 'bunx',
          args: ['@modelcontextprotocol/server-filesystem', '.'] 
        }
      }
    };
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('filesystemServer');
    
    // Get the client
    const client = managerInstance.getClient('filesystemServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Get the list of resources
      const resources = await client.listResources();
      
      // Verify we have some resources
      expect(resources.length).toBeGreaterThan(0);
      
      // Get a specific resource - README.md should exist in most projects
      const readmeResource = await client.readResource('file:///README.md');
      
      // Verify the resource content structure
      expect(readmeResource).toBeDefined();
      expect(readmeResource.contents).toBeDefined();
      expect(Array.isArray(readmeResource.contents)).toBe(true);
      expect(readmeResource.contents.length).toBeGreaterThan(0);
      
      // Check the resource content properties
      const firstContent = readmeResource.contents[0];
      expect(firstContent).toHaveProperty('uri');
      expect(firstContent).toHaveProperty('name');
      expect(firstContent).toHaveProperty('text');
      expect(firstContent).toHaveProperty('mimeType');
      
      // The README should contain some text
      expect(firstContent.text.length).toBeGreaterThan(0);
      expect(firstContent.mimeType).toContain('text/');
      
      // Read package.json as another resource
      const packageResource = await client.readResource('file:///package.json');
      
      // Should have contents
      expect(packageResource.contents.length).toBeGreaterThan(0);
      
      // Should have valid JSON
      const packageContent = packageResource.contents[0];
      expect(() => JSON.parse(packageContent.text)).not.toThrow();
      
      // Try reading a directory (some filesystem servers return multiple resources for a directory)
      try {
        const dirResource = await client.readResource('file:///src/');
        
        // If successful, verify it has the proper structure
        if (dirResource.contents.length > 0) {
          for (const content of dirResource.contents) {
            expect(content).toHaveProperty('uri');
            expect(content).toHaveProperty('name');
            expect(content).toHaveProperty('text');
          }
        }
      } catch (error) {
        // Some filesystem implementations don't support reading directories,
        // so we'll just log and continue
        console.log('Directory reading not supported or failed');
      }
    }
  });
}); 