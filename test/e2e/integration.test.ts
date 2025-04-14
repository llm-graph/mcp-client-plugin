import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { NOTIFICATION_METHODS } from '../../src/constants';
import type { ManagerAPI, LoggingLevel, Progress } from '../../src/types';

describe('Integration E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('all MCP client features work together with one server', async () => {
    // Create a memory server which supports all MCP features
    const config = {
      memoryServer: {
        transport: {
          type: 'stdio' as const,
          command: 'bunx',
          args: ['@modelcontextprotocol/server-memory']
        }
      }
    };
    
    // Track notifications
    const notifications: Array<{
      method: string;
      params?: unknown;
    }> = [];
    
    // Track progress updates separately
    const progressUpdates: Progress[] = [];
    
    // Track log messages
    const logMessages: Array<{
      level: LoggingLevel;
      message: string;
    }> = [];
    
    // Create notification handler
    const notificationHandler = (serverName: string, notification: {method: string; params?: unknown}) => {
      notifications.push(notification);
      
      // Handle specific notification types
      if (notification.method === NOTIFICATION_METHODS.PROGRESS && notification.params) {
        const params = notification.params as {progress: Progress};
        if (params.progress) {
          progressUpdates.push(params.progress);
        }
      }
      
      if (notification.method === NOTIFICATION_METHODS.LOGGING_MESSAGE && notification.params) {
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
      // 1. Set logging level to debug for more verbose logs
      await client.setLoggingLevel('debug');
      
      // 2. List available tools
      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      // Verify tool structure
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('inputSchema');
      }
      
      // 3. Create a resource for testing
      const resourceName = `test-resource-${Date.now()}`;
      await client.callTool('createResource', {
        uri: `memory:///${resourceName}`,
        name: resourceName,
        content: 'This is test resource content',
        mimeType: 'text/plain'
      });
      
      // 4. List resources
      const resources = await client.listResources();
      expect(Array.isArray(resources)).toBe(true);
      
      // Find our created resource
      const createdResource = resources.find(r => r.name === resourceName);
      expect(createdResource).toBeDefined();
      expect(createdResource?.uri).toBe(`memory:///${resourceName}`);
      
      // 5. Read resource with proper structure
      const resourceContent = await client.readResource(`memory:///${resourceName}`);
      expect(resourceContent).toHaveProperty('contents');
      expect(Array.isArray(resourceContent.contents)).toBe(true);
      expect(resourceContent.contents.length).toBe(1);
      expect(resourceContent.contents[0].text).toBe('This is test resource content');
      expect(resourceContent.contents[0].mimeType).toBe('text/plain');
      
      // 6. Create a prompt with completable arguments
      const promptName = `test-prompt-${Date.now()}`;
      await client.callTool('createPrompt', {
        name: promptName,
        description: 'Test prompt with completable arguments',
        prompt: 'Hello {{name}} from {{country}}!',
        arguments: [
          {
            name: 'name',
            description: 'Name of the person',
            required: true
          },
          {
            name: 'country',
            description: 'Country of origin',
            required: true,
            completions: ['Germany', 'United States', 'Japan', 'Brazil', 'Australia']
          }
        ]
      });
      
      // 7. List prompts
      const prompts = await client.listPrompts();
      expect(Array.isArray(prompts)).toBe(true);
      
      // Find our created prompt
      const createdPrompt = prompts.find(p => p.name === promptName);
      expect(createdPrompt).toBeDefined();
      expect(createdPrompt?.arguments?.length).toBe(2);
      
      // 8. Complete an argument
      const completion = await client.complete({
        ref: {
          type: 'ref/prompt',
          name: promptName
        },
        argument: {
          name: 'country',
          value: 'Ja'
        }
      });
      
      expect(completion).toHaveProperty('completion');
      expect(Array.isArray(completion.completion.values)).toBe(true);
      expect(completion.completion.values).toContain('Japan');
      
      // 9. Get the prompt with filled arguments
      const filledPrompt = await client.getPrompt(promptName, {
        name: 'Alice',
        country: 'Japan'
      });
      
      expect(filledPrompt).toHaveProperty('messages');
      expect(Array.isArray(filledPrompt.messages)).toBe(true);
      expect(filledPrompt.messages.length).toBe(1);
      expect(filledPrompt.messages[0].content.text).toContain('Hello Alice from Japan');
      
      // 10. Create a resource template
      const templateName = `test-template-${Date.now()}`;
      await client.callTool('createResourceTemplate', {
        uriTemplate: `memory:///{name}-${templateName}.txt`,
        name: templateName,
        description: 'Test resource template',
        mimeType: 'text/plain',
        arguments: [
          {
            name: 'name',
            description: 'Name to include in the URI',
            required: true
          }
        ]
      });
      
      // 11. List resource templates
      const templates = await client.listResourceTemplates();
      expect(Array.isArray(templates)).toBe(true);
      
      // Find our created template
      const createdTemplate = templates.find(t => t.name === templateName);
      expect(createdTemplate).toBeDefined();
      expect(createdTemplate?.uriTemplate).toContain(templateName);
      
      // 12. Call a tool with progress tracking
      // Create a slow tool for progress tracking
      await client.callTool('createTool', {
        name: 'slowCounter',
        description: 'A slow counting tool that reports progress',
        parameters: {
          type: 'object',
          properties: {
            steps: { type: 'number', default: 10 }
          }
        },
        execute: `
          async function execute({ steps = 10 }, { reportProgress }) {
            let progress = 0;
            for (let i = 0; i < steps; i++) {
              progress = i;
              reportProgress({ progress, total: steps });
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return "Counting complete: " + steps;
          }
        `
      });
      
      // Call the slow tool and track progress with a local callback
      const localProgressUpdates: Progress[] = [];
      const slowResult = await client.callTool<string>(
        'slowCounter', 
        { steps: 5 }, 
        { onProgress: (progress) => localProgressUpdates.push(progress) }
      );
      
      // Verify result 
      expect(typeof slowResult).toBe('string');
      expect(slowResult).toContain('Counting complete');
      
      // Verify progress was tracked
      expect(localProgressUpdates.length).toBeGreaterThan(0);
      expect(localProgressUpdates[0].total).toBe(5);
      
      // 13. Verify we received log messages via the notification handler
      expect(logMessages.length).toBeGreaterThan(0);
      
      // Should have different log levels since we set level to debug
      expect(logMessages.some(log => log.level === 'debug')).toBe(true);
      
      // 14. Test error handling by calling a non-existent tool
      try {
        await client.callTool('nonExistentTool', {});
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        // Error message should mention the tool not being found
        expect((error as Error).message).toMatch(/not found|unknown tool|doesn't exist/i);
      }
      
      // 15. Send a ping to verify connection is still alive
      await client.ping();
      
      // Test disconnection at the end
      await client.disconnect();
      
      // Verify we can no longer interact with the client
      try {
        await client.ping();
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    }
  });
}); 