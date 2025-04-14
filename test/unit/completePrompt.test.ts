import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { resolveTestDependencies, createMemoryServerConfig } from '../../src/test-utils';
import type { ManagerAPI } from '../../src/types';

describe('Complete Prompt Arguments', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('complete sends correct request and handles response', async () => {
    // Check dependencies with improved resolution
    const dependencies = await resolveTestDependencies();
    const serverPkg = '@modelcontextprotocol/server-memory';
    
    if (!dependencies[serverPkg]) {
      console.warn(`Skipping test: ${serverPkg} not found - this should not happen if it's in package.json`);
      return;
    }
    
    // Create a real memory server
    const config = createMemoryServerConfig();
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('memoryServer');
    
    // Get the client
    const client = managerInstance.getClient('memoryServer');
    expect(client).toBeDefined();
    
    if (client) {
      // First create a prompt that has completable arguments
      await client.callTool('createPrompt', {
        name: 'countryPoem',
        description: 'Generates a poem about a country',
        arguments: [
          {
            name: 'countryName',
            description: 'Name of the country',
            required: true,
            completions: ['Germany', 'France', 'Japan', 'Canada', 'Australia']
          }
        ]
      });
      
      // Now test the complete functionality
      const completion = await client.complete({
        ref: {
          type: 'ref/prompt',
          name: 'countryPoem'
        },
        argument: {
          name: 'countryName',
          value: 'Ger'
        }
      });
      
      // Verify the completion structure
      expect(completion).toBeDefined();
      expect(completion.completion).toBeDefined();
      expect(Array.isArray(completion.completion.values)).toBe(true);
      
      // Should suggest Germany as completion
      expect(completion.completion.values).toContain('Germany');
    }
  });
}); 