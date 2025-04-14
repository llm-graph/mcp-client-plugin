import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import type { ManagerAPI } from '../../src/types';

describe('Complete Arguments E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('completes arguments for a prompt', async () => {
    // Create a real-world prompt server that supports argument completion
    const config = {
      promptServer: {
        transport: {
          type: 'stdio' as const,
          command: 'bunx',
          args: ['@modelcontextprotocol/server-memory'] 
        }
      }
    };
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('promptServer');
    
    // Get the client
    const client = managerInstance.getClient('promptServer');
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
      
      // Try a different prefix
      const completion2 = await client.complete({
        ref: {
          type: 'ref/prompt',
          name: 'countryPoem'
        },
        argument: {
          name: 'countryName',
          value: 'Jap'
        }
      });
      
      // Should suggest Japan as completion
      expect(completion2.completion.values).toContain('Japan');
      
      // Validate that the prompt was created properly
      const prompts = await client.listPrompts();
      const countryPrompt = prompts.find(p => p.name === 'countryPoem');
      expect(countryPrompt).toBeDefined();
      expect(countryPrompt?.arguments).toHaveLength(1);
    }
  });
}); 