import { describe, test, expect, afterEach } from 'bun:test';
import { manager } from '../../src/core';
import { Progress } from '../../src/types';
import { resolveTestDependencies, createCalculatorServerConfig } from '../../src/test-utils';
import type { ManagerAPI } from '../../src/types';

describe('Progress Tracking', () => {
  let managerInstance: ManagerAPI;
  
  afterEach(async () => {
    if (managerInstance) {
      await managerInstance.disconnectAll();
    }
  });

  // This test requires the calculator server which is now properly detected
  test('callTool with onProgress receives progress notifications', async () => {
    // Check dependencies with improved resolution
    const dependencies = await resolveTestDependencies();
    const serverPkg = '@wrtnlabs/calculator-mcp';
    
    if (!dependencies[serverPkg]) {
      console.warn(`Skipping test: ${serverPkg} not found`);
      return;
    }
    
    // Create a real calculator server with progress reporting enabled
    const config = createCalculatorServerConfig({
      enableProgressReporting: true
    });
    
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
      
      // Call the slow calculate tool which reports progress
      const result = await client.callTool<{content: Array<{type: string, text: string}>}>(
        'slowCalculate',
        {
          expression: '2+2',
          delayMs: 500 // Make it slow enough to report progress
        },
        {
          onProgress
        }
      );
      
      // Verify the tool execution result
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('4');
      
      // Verify progress was tracked
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
    }
  });
}); 