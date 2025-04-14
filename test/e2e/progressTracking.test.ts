import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { Progress } from '../../src/types';
import type { ManagerAPI } from '../../src/types';

describe('Progress Tracking E2E', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  test('tracks progress from a tool execution', async () => {
    // Create a real server using the calculator MCP server that has progress reporting
    const config = {
      calculatorServer: {
        transport: {
          type: 'stdio' as const,
          command: 'bunx',
          args: ['@wrtnlabs/calculator-mcp', '--enable-progress-reporting']
        }
      }
    };
    
    // Create manager and connect to server
    managerInstance = await manager(config).use('calculatorServer');
    
    // Get the client
    const client = managerInstance.getClient('calculatorServer');
    expect(client).toBeDefined();
    
    if (client) {
      // Progress tracking array
      const progressUpdates: Progress[] = [];
      
      // Create a progress callback
      const onProgress = (progress: Progress) => {
        progressUpdates.push(progress);
      };
      
      // Call a tool with progress tracking
      // The slowCalculate tool in the calculator server reports progress
      const result = await client.callTool<{result: number}>(
        'slowCalculate', 
        { 
          expression: '2+2',
          delayMs: 500  // Make it slow enough to report progress
        },
        {
          onProgress
        }
      );
      
      // Verify tool execution result
      expect(result).toBeDefined();
      
      // The calculator should have correctly computed 2+2
      expect(result.result).toBe(4);
      
      // And we should have received at least one progress update
      expect(progressUpdates.length).toBeGreaterThan(0);
      
      // Each progress update should have the correct structure
      for (const progress of progressUpdates) {
        expect(progress).toHaveProperty('progress');
        expect(progress).toHaveProperty('total');
        expect(typeof progress.progress).toBe('number');
        expect(typeof progress.total).toBe('number');
        expect(progress.progress).toBeGreaterThanOrEqual(0);
        expect(progress.progress).toBeLessThanOrEqual(progress.total);
      }
      
      // The last update should be close to completion
      if (progressUpdates.length > 0) {
        const lastUpdate = progressUpdates[progressUpdates.length - 1];
        expect(lastUpdate.progress).toBeGreaterThan(0);
      }
    }
  });
}); 