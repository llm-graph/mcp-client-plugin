import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { resolveTestDependencies, createMemoryServerConfig } from '../../src/test-utils';
import type { ManagerAPI } from '../../src/types';

describe('Basic Connectivity', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('can connect to the memory server and ping it', async () => {
    // Log paths to help debug
    console.log('Current directory:', process.cwd());
    console.log('Paths:', process.env.PATH);
    
    // Check dependencies with improved resolution
    const dependencies = await resolveTestDependencies();
    const serverPkg = '@modelcontextprotocol/server-memory';
    
    if (!dependencies[serverPkg]) {
      console.warn(`Skipping test: ${serverPkg} not found - this should not happen if it's in package.json`);
      return;
    }
    
    // Create a real memory server with verbose debugging
    const config = createMemoryServerConfig({
      debugMode: true,
      env: { DEBUG: 'true' }
    });
    
    console.log('Connecting to server with config:', JSON.stringify(config, null, 2));
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('memoryServer');
    
    // Get the client
    const client = managerInstance.getClient('memoryServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Just try to ping
      try {
        console.log('Sending ping...');
        await client.ping();
        console.log('Ping succeeded!');
        expect(true).toBe(true); // Test passed
      } catch (error) {
        console.error('Ping failed:', error);
        throw error;
      }
    }
  });
}); 