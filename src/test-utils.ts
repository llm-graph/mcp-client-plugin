import path from 'node:path';
import { existsSync } from 'node:fs';
import { LOG_LEVELS, log, logError } from './utils';
import { createMcpServerWrapper } from './utils';
import { ManagerConfig, StdioTransportConfig } from './types';

/**
 * Available package execution methods
 */
export type PackageRunner = 'node' | 'npx' | 'bunx' | 'uv' | 'pnpm' | 'yarn';

/**
 * Supported test servers with their package names and paths
 */
export const SERVER_PACKAGES = {
  calculator: {
    packageName: '@wrtnlabs/calculator-mcp',
    binPath: 'bin/index.js',
    responseTypes: {
      // The calculator server returns responses with content arrays
      add: { content: Array<{ type: string; text: string }> },
      sub: { content: Array<{ type: string; text: string }> },
      mul: { content: Array<{ type: string; text: string }> },
      div: { content: Array<{ type: string; text: string }> },
      mod: { content: Array<{ type: string; text: string }> },
      sqrt: { content: Array<{ type: string; text: string }> }
    }
  },
  // Add other known MCP server packages here
};

/**
 * Generate command and args for different package execution methods
 */
export const getPackageRunnerCommand = (
  runner: PackageRunner,
  packageName: string,
  scriptPath?: string
): { command: string; args: string[] } => {
  switch (runner) {
    case 'node':
      if (!scriptPath) {
        throw new Error('Script path required for direct node execution');
      }
      return {
        command: process.execPath,
        args: [scriptPath]
      };
    
    case 'npx':
      return {
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: [packageName]
      };
      
    case 'bunx':
      return {
        command: process.platform === 'win32' ? 'bunx.exe' : 'bunx',
        args: [packageName]
      };
      
    case 'uv':
      return {
        command: process.platform === 'win32' ? 'uv.exe' : 'uv',
        args: ['run', packageName]
      };
      
    case 'pnpm':
      return {
        command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        args: ['exec', packageName]
      };
      
    case 'yarn':
      return {
        command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
        args: ['exec', packageName]
      };
      
    default:
      throw new Error(`Unsupported package runner: ${runner}`);
  }
};

/**
 * Checks if a server package is installed and returns its path
 */
export const findServerPackage = (
  packageInfo: { packageName: string; binPath: string }
): string | undefined => {
  const packageDir = path.resolve(`./node_modules/${packageInfo.packageName}`);
  const indexPath = path.resolve(packageDir, packageInfo.binPath);
  
  return existsSync(indexPath) ? indexPath : undefined;
};

/**
 * Creates a testing configuration for a specific MCP server
 */
export const createTestServerConfig = (
  serverType: keyof typeof SERVER_PACKAGES,
  options?: {
    env?: Record<string, string>;
    handleNonStandardOutput?: boolean;
    debugMode?: boolean;
    packageRunner?: PackageRunner;
  }
): ManagerConfig => {
  const serverInfo = SERVER_PACKAGES[serverType];
  if (!serverInfo) {
    throw new Error(`Unknown server type: ${serverType}`);
  }
  
  // Default to node runner that requires the package to be installed
  const packageRunner = options?.packageRunner || 'node';
  
  // For node runner, we need to find the local package
  if (packageRunner === 'node') {
    const serverPath = findServerPackage(serverInfo);
    if (!serverPath) {
      throw new Error(
        `Server package ${serverInfo.packageName} not installed. ` +
        `Please install it with: npm install ${serverInfo.packageName}`
      );
    }
    
    // Create a configuration based on server type
    switch (serverType) {
      case 'calculator':
        return createCalculatorConfig(serverPath, packageRunner, options);
      default:
        // Default configuration for well-behaved servers
        return {
          [serverType]: {
            transport: {
              type: 'stdio',
              command: process.execPath,
              args: [serverPath],
              env: options?.env,
              options: {
                debugMode: options?.debugMode
              }
            } as StdioTransportConfig
          }
        };
    }
  } else {
    // For other runners (npx, bunx, etc.), we will use the package name directly
    // These don't require local installation
    const { command, args } = getPackageRunnerCommand(packageRunner, serverInfo.packageName);
    
    // Create a configuration based on server type
    switch (serverType) {
      case 'calculator':
        return createCalculatorConfig(undefined, packageRunner, options, command, args);
      default:
        // Default configuration for well-behaved servers
        return {
          [serverType]: {
            transport: {
              type: 'stdio',
              command,
              args,
              env: options?.env,
              options: {
                debugMode: options?.debugMode
              }
            } as StdioTransportConfig
          }
        };
    }
  }
};

/**
 * Creates a test configuration for the calculator server
 * Handles the non-standard output behavior
 */
const createCalculatorConfig = (
  serverPath?: string,
  packageRunner: PackageRunner = 'node',
  options?: {
    env?: Record<string, string>;
    handleNonStandardOutput?: boolean;
    debugMode?: boolean;
  },
  execCommand?: string,
  execArgs?: string[]
): ManagerConfig => {
  // Get the command and args based on the package runner
  let command: string;
  let args: string[];
  
  if (execCommand && execArgs) {
    command = execCommand;
    args = execArgs;
  } else if (serverPath && packageRunner === 'node') {
    command = process.execPath;
    args = [serverPath];
  } else {
    const runnerConfig = getPackageRunnerCommand(
      packageRunner, 
      SERVER_PACKAGES.calculator.packageName
    );
    command = runnerConfig.command;
    args = runnerConfig.args;
  }
  
  // Calculator server outputs non-JSON text on startup
  if (options?.handleNonStandardOutput !== false) {
    log(LOG_LEVELS.INFO, `Creating wrapper for non-standard calculator server`);
    
    try {
      if (packageRunner === 'node' && !serverPath) {
        throw new Error('Server path required for direct node execution');
      }
      
      // Create a wrapper
      const { wrapperPath } = createMcpServerWrapper(
        serverPath || command,
        {
          skipInitialOutput: true,
          debugMode: options?.debugMode,
          preInitCommands: !serverPath ? args : undefined // For package managers, pass args as pre-init commands
        }
      );
      
      // Return config with the wrapper
      return {
        calculatorServer: {
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [wrapperPath],
            env: options?.env || { DEBUG: 'true' },
            options: {
              debugMode: options?.debugMode
            }
          } as StdioTransportConfig
        }
      };
    } catch (err) {
      logError(LOG_LEVELS.WARN, `Failed to create wrapper for calculator server: ${err}`);
      // Fall back to ignoring non-JSON lines
      return {
        calculatorServer: {
          transport: {
            type: 'stdio',
            command,
            args,
            env: options?.env || { DEBUG: 'true' },
            options: {
              ignoreNonJsonLines: true,
              debugMode: options?.debugMode
            }
          } as StdioTransportConfig
        }
      };
    }
  }
  
  // If not handling non-standard output, just use the server directly
  // with ignoreNonJsonLines option
  return {
    calculatorServer: {
      transport: {
        type: 'stdio',
        command,
        args,
        env: options?.env || { DEBUG: 'true' },
        options: {
          ignoreNonJsonLines: true,
          debugMode: options?.debugMode
        }
      } as StdioTransportConfig
    }
  };
};

/**
 * Returns a testing configuration for multiple MCP servers
 */
export const createTestEnvironment = (
  servers: Array<{
    type: keyof typeof SERVER_PACKAGES;
    options?: {
      env?: Record<string, string>;
      handleNonStandardOutput?: boolean;
      debugMode?: boolean;
      packageRunner?: PackageRunner;
    };
  }>
): ManagerConfig => {
  // Combine configurations for all requested servers
  return servers.reduce((config, server) => {
    try {
      const serverConfig = createTestServerConfig(server.type, server.options);
      return { ...config, ...serverConfig };
    } catch (err) {
      logError(LOG_LEVELS.WARN, `Skipping server ${server.type}: ${err}`);
      return config;
    }
  }, {} as ManagerConfig);
};

/**
 * Helper type for calculator server responses
 */
export type CalculatorToolResponse = {
  content?: Array<{ type: string; text: string }>;
};

/**
 * Helper function to extract text from calculator server responses
 */
export const extractCalculatorText = (response: CalculatorToolResponse): string => {
  return response.content?.[0]?.text || '';
};

/**
 * Helper function to assert calculator operation results
 */
export const assertCalculatorResult = (
  response: CalculatorToolResponse, 
  expectedResult: number | string
): void => {
  const text = extractCalculatorText(response);
  if (!text.includes(String(expectedResult))) {
    throw new Error(`Expected calculator result to contain "${expectedResult}", but got: "${text}"`);
  }
};

// Add wrappers for the test servers to handle progress tracking
export const createTestServerWithProgressSupport = (
  baseConfig: ManagerConfig
): ManagerConfig => {
  // We'll modify the config to add support for progress tracking
  const config = { ...baseConfig };
  
  // Create mock progress tracking wrapper
  Object.keys(config).forEach(serverName => {
    const serverConfig = config[serverName];
    
    if (serverConfig?.transport?.type === 'stdio') {
      // Create a new transport config with progress reporting
      const transport = { ...serverConfig.transport };
      const newArgs = [...(transport.args || [])];
      
      // Add progress tracking flag if not already present
      if (!newArgs.includes('--enable-progress-reporting')) {
        newArgs.push('--enable-progress-reporting');
      }
      
      // Create new transport with updated args
      config[serverName] = {
        ...serverConfig,
        transport: {
          ...transport,
          args: newArgs
        }
      };
    }
  });
  
  return config;
};

// Helper for resolving MCP server-related tests
export const resolveTestDependencies = async (): Promise<Record<string, boolean>> => {
  // Check for required dependencies
  const packages = [
    '@modelcontextprotocol/server-memory',
    '@modelcontextprotocol/server-filesystem',
    '@wrtnlabs/calculator-mcp'
  ];
  
  const results: Record<string, boolean> = {};
  
  // Check each package individually
  for (const pkg of packages) {
    try {
      // Try multiple resolution strategies
      try {
        // First try the built-in require.resolve
        require.resolve(pkg);
        results[pkg] = true;
      } catch (e1) {
        // If that fails, try with path prefix
        try {
          require.resolve(`./node_modules/${pkg}`);
          results[pkg] = true;
        } catch (e2) {
          // If that fails, check if node_modules directory exists
          if (existsSync(`./node_modules/${pkg}`)) {
            results[pkg] = true;
          } else {
            results[pkg] = false;
          }
        }
      }
    } catch (e) {
      // If all resolution attempts fail, mark as not available
      results[pkg] = false;
    }
  }
  
  // Report missing packages
  const missingPackages = Object.entries(results)
    .filter(([_, installed]) => !installed)
    .map(([pkg]) => pkg);
  
  if (missingPackages.length > 0) {
    console.warn(`WARNING: The following packages required for tests are missing: ${missingPackages.join(', ')}`);
    console.warn('Some tests may fail. Install them with: bun add -D ' + missingPackages.join(' '));
  }
  
  return results;
};

export const createMemoryServerConfig = (options?: {
  env?: Record<string, string>;
  debugMode?: boolean;
}): ManagerConfig => {
  // Use a wrapper for better stability in tests
  try {
    // Create a wrapper to handle non-standard output
    const { wrapperPath } = createMcpServerWrapper(
      process.platform === 'win32' ? 'bunx.exe' : 'bunx',
      {
        skipInitialOutput: true,
        debugMode: options?.debugMode,
        preInitCommands: ['@modelcontextprotocol/server-memory'] // Pass args as pre-init commands
      }
    );
    
    // Return config with the wrapper and retry options
    return {
      memoryServer: {
        transport: {
          type: 'stdio' as const,
          command: process.execPath,
          args: [wrapperPath],
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  } catch (err) {
    // Fall back to direct execution
    logError(LOG_LEVELS.WARN, `Failed to create wrapper for memory server: ${err}`);
    
    // Direct execution with retry options
    return {
      memoryServer: {
        transport: {
          type: 'stdio' as const,
          command: process.platform === 'win32' ? 'bunx.exe' : 'bunx',
          args: ['@modelcontextprotocol/server-memory'],
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  }
};

export const createFilesystemServerConfig = (
  rootPath: string = '.',
  options?: {
    env?: Record<string, string>;
    debugMode?: boolean;
  }
): ManagerConfig => {
  // Use a wrapper for better stability in tests
  try {
    // Create a wrapper to handle non-standard output
    const { wrapperPath } = createMcpServerWrapper(
      process.platform === 'win32' ? 'bunx.exe' : 'bunx',
      {
        skipInitialOutput: true,
        debugMode: options?.debugMode,
        preInitCommands: ['@modelcontextprotocol/server-filesystem', rootPath] // Pass args as pre-init commands
      }
    );
    
    // Return config with the wrapper and retry options
    return {
      filesystemServer: {
        transport: {
          type: 'stdio' as const,
          command: process.execPath,
          args: [wrapperPath],
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  } catch (err) {
    // Fall back to direct execution
    logError(LOG_LEVELS.WARN, `Failed to create wrapper for filesystem server: ${err}`);
    
    // Direct execution with retry options
    return {
      filesystemServer: {
        transport: {
          type: 'stdio' as const,
          command: process.platform === 'win32' ? 'bunx.exe' : 'bunx',
          args: ['@modelcontextprotocol/server-filesystem', rootPath],
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  }
};

export const createCalculatorServerConfig = (
  options?: {
    env?: Record<string, string>;
    debugMode?: boolean;
    enableProgressReporting?: boolean;
  }
): ManagerConfig => {
  // Create args with progress tracking if requested
  const args = ['@wrtnlabs/calculator-mcp'];
  if (options?.enableProgressReporting) {
    args.push('--enable-progress-reporting');
  }
  
  // Use a wrapper for better stability in tests
  try {
    // Create a wrapper to handle non-standard output and progress reporting
    const { wrapperPath } = createMcpServerWrapper(
      process.platform === 'win32' ? 'bunx.exe' : 'bunx',
      {
        skipInitialOutput: true,
        debugMode: options?.debugMode,
        preInitCommands: args // Pass args as pre-init commands
      }
    );
    
    // Return a config with retry options
    return {
      calculatorServer: {
        transport: {
          type: 'stdio' as const,
          command: process.execPath,
          args: [wrapperPath],
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  } catch (err) {
    // Fall back to direct execution if wrapper creation fails
    logError(LOG_LEVELS.WARN, `Failed to create wrapper for calculator server: ${err}`);
    
    return {
      calculatorServer: {
        transport: {
          type: 'stdio' as const,
          command: process.platform === 'win32' ? 'bunx.exe' : 'bunx',
          args,
          env: options?.env || { DEBUG: 'true' },
          options: {
            ignoreNonJsonLines: true,
            debugMode: options?.debugMode,
            initializationRetries: 3,
            initializationRetryDelay: 500
          }
        }
      }
    };
  }
}; 