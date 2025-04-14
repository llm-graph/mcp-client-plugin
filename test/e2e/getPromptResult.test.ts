import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import type { ManagerAPI } from '../../src/types';

describe('Get Prompt Result E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('gets a prompt with properly structured message objects', async () => {
    // Create a real-world prompt server
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
      // Create a test prompt
      await client.callTool('createPrompt', {
        name: 'summarizeText',
        description: 'Summarizes a text into a concise form',
        prompt: 'Please summarize the following text: {{text}}',
        arguments: [
          {
            name: 'text',
            description: 'The text to summarize',
            required: true
          }
        ]
      });
      
      // Get the prompt
      const promptResult = await client.getPrompt('summarizeText', {
        text: 'This is a long text that needs to be summarized. It contains multiple sentences and ideas that should be condensed into a shorter form while preserving the key points and main message.'
      });
      
      // Verify the prompt structure
      expect(promptResult).toBeDefined();
      expect(promptResult.description).toBe('Summarizes a text into a concise form');
      expect(Array.isArray(promptResult.messages)).toBe(true);
      expect(promptResult.messages.length).toBeGreaterThan(0);
      
      // Check the message structure
      const firstMessage = promptResult.messages[0];
      expect(firstMessage).toHaveProperty('role');
      expect(firstMessage).toHaveProperty('content');
      expect(firstMessage.content).toHaveProperty('type');
      expect(firstMessage.content).toHaveProperty('text');
      
      // The content should contain the supplied argument
      expect(firstMessage.content.text).toContain('This is a long text');
      
      // Create and get another prompt to verify consistency
      await client.callTool('createPrompt', {
        name: 'greetPerson',
        description: 'Generates a greeting for a person',
        prompt: 'Hello {{name}}!',
        arguments: [
          {
            name: 'name',
            description: 'Name of the person to greet',
            required: true
          }
        ]
      });
      
      const greetingPrompt = await client.getPrompt('greetPerson', { name: 'Alice' });
      expect(greetingPrompt.messages[0].content.text).toContain('Hello Alice');
    }
  });
}); 