import { manager } from '../index'; // Use relative import for local example
import type { ManagerConfig, NotificationHandler } from '../index';

// 1. Define your server configurations
const config: ManagerConfig = {
  // An MCP server communicating via standard I/O
  memoryServer: {
    transport: {
      type: 'stdio',
      command: 'bunx', // Use bunx to run package executables
      args: ['@modelcontextprotocol/server-memory'], // Example command
      // env: { API_KEY: '...' } // Optional environment variables
    },
  },
  // Add another server (e.g., filesystem)
  fileSystem: {
    transport: {
      type: 'stdio',
      command: 'bunx',
      args: ['@modelcontextprotocol/server-filesystem', '.'], // Allow access to current dir
    }
  },
};

// 2. Optional: Define a handler for server notifications
const handleNotifications: NotificationHandler = (serverName, notification) => {
  console.log(`🔔 Notification [${serverName}]: ${notification.method}`, notification.params ?? '');
};

// 3. Use the manager
async function run() {
  console.log('🚀 Initializing MCP Manager...');
  try {
    // Initialize the manager and connect to servers with method chaining
    // The connection happens asynchronously but the API is immediately returned for chaining
    const mcpManager = manager(config, { onNotification: handleNotifications })
      .use('memoryServer')
      .use('fileSystem');

    console.log('✅ Manager initialized with server connections in progress...');

    // 4. Get client APIs for specific servers
    // Note: getClient will wait for the pending connection if needed
    const memory = mcpManager.getClient('memoryServer');
    const fs = mcpManager.getClient('fileSystem');

    // 5. Interact with the servers
    if (memory) {
      console.log('\n🧠 Querying Memory Server...');
      const memTools = await memory.listTools();
      console.log('Memory Tools:', memTools.map(t => t.name));
    }

    if (fs) {
      console.log('\n📁 Querying Filesystem Server...');
      const fsResources = await fs.listResources();
      console.log('FS Resources:', fsResources.map(r => r.uri));
    }

    // 6. Disconnect all servers when done
    // This will wait for any pending connections to complete first
    console.log('\n🔌 Disconnecting all servers...');
    await mcpManager.disconnectAll();
    console.log('✅ Disconnected.');

  } catch (error) {
    console.error('❌ MCP Manager Error:', error);
  }
}

run(); 