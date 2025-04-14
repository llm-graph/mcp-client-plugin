# ⚡️ MCP Client Plugin: Zero Dependencies, Pure Functionality, Built for Bun ⚡️

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://example.com) <!-- Replace with actual badge -->
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://example.com) <!-- Replace with actual badge -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![NPM Version](https://img.shields.io/npm/v/mcp-client-plugin.svg?style=flat)](https://www.npmjs.com/package/mcp-client-plugin)
[![Bun Build](https://github.com/<your-username>/mcp-client-plugin/actions/workflows/main.yml/badge.svg)](https://github.com/<your-username>/mcp-client-plugin/actions/workflows/main.yml)

Tired of MCP clients bogged down by dependencies, complex OOP structures, and Node.js legacy? **MCP Client Plugin** is the antidote.

Built from the ground up with a **Bun-first, zero-dependency, functional programming** mindset, this plugin provides a refreshingly modern and efficient way to interact with Model Context Protocol servers *and* manage their processes seamlessly.

## Why Choose MCP Client Plugin? ✨

This plugin stands out by offering:

*   💧 **Pure Functional & Immutable Core:** Predictable state management, easier reasoning, and pure functions eliminate side effects common in OOP. No classes, no `this`.
*   🚫 **Truly Zero Runtime Dependencies:** Relies *exclusively* on built-in Bun APIs (process spawning, fetch/SSE, streams). No `node_modules` baggage for core functionality.
*   🔥 **Bun-Native Performance & Mindset:** Designed and optimized for Bun's blazing-fast runtime, leveraging its speed and integrated tooling.
*   ⚙️ **Integrated Server Process Management:** Fluently start, stop, communicate with, and manage MCP server lifecycles (Stdio transport) directly within the client manager API. No separate manager needed!
*   🌐 **Multi-Transport Support:** Seamlessly handle both `stdio` (for local processes) and `sse` (HTTP Server-Sent Events) transports.
*   ⛓️ **Fluent, Chainable API:** Inspired by ElysiaJS, manage servers and access client APIs with elegant method chaining (`.use()`).
*   🔒 **Type-Safe by Design:** Strong TypeScript definitions throughout, avoiding `any` or `unknown` for robust development.
*   💨 **Lightweight & Direct:** Minimal abstraction layers between your code and the MCP communication.
*   🎯 **Exceptional DX:** Strongly typed, predictable API designed to get you productive *fast*.

## 📊 Feature Comparison

| Feature                 | ✨ MCP Client Plugin                 | Typical SDK Wrappers             | Foundational Clients / SDKs    |
| :---------------------- | :----------------------------------- | :------------------------------- | :----------------------------- |
| **Dependencies**        | **✨ Zero Runtime!**                 | SDK + Helpers (Zod, etc.)        | SDK Core / Specific Libs       |
| **Paradigm**            | **💧 Pure Functional**               | Often OOP/Mixed                  | Often OOP/Class-based        |
| **State Management**    | **🧊 Immutable**                     | Internal/Mutable                 | Internal/Mutable               |
| **Process Management**  | **✅ Integrated (Stdio)**            | Usually Separate                 | Usually Separate / Manual      |
| **Transport Handling**  | **🚀 Bun Native (Stdio/SSE)**        | Relies on SDK/Node APIs          | Relies on SDK/Node APIs      |
| **API Style**           | **🔗 Fluent Chaining**               | Method-based                     | Method-based                 |
| **Runtime**             | **🔥 Bun Optimized**                 | Node.js (May work in Bun)        | Node.js (May work in Bun)    |
| **Bundle Size**         | **🤏 Tiny**                          | Small -> Medium                  | Medium                         |

## 📦 Installation

```bash
bun add mcp-client-plugin
# or
npm install mcp-client-plugin
# or
yarn add mcp-client-plugin
```

## 🚀 Quick Start

Get up and running in seconds!

```typescript
// example.ts
import { manager } from 'mcp-client-plugin'; // Assuming installed package name
import type { ManagerConfig, NotificationHandler } from 'mcp-client-plugin';

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
  // Example SSE server (if you have one running)
  // searchServer: {
  //   transport: {
  //     type: 'sse',
  //     url: 'http://localhost:3001/mcp', // URL for POST and SSE endpoint
  //     // headers: { 'Authorization': 'Bearer ...' } // Optional headers
  //   }
  // }
};

// 2. Optional: Define a handler for server notifications
const handleNotifications: NotificationHandler = (serverName, notification) => {
  console.log(`🔔 Notification [${serverName}]: ${notification.method}`, notification.params ?? '');
};

// 3. Initialize the manager and connect to servers using the chainable API
async function run() {
  console.log('🚀 Initializing MCP Manager...');
  try {
    const mcpManager = await manager(config, { onNotification: handleNotifications })
      .use('memoryServer')     // Connect to the memory server
      .use('fileSystem');      // Connect to the filesystem server
      // .use('searchServer') // Connect to the SSE server

    console.log('✅ Servers Connected & Ready!');

    // 4. Get client APIs for specific servers
    const memory = mcpManager.getClient('memoryServer');
    const fs = mcpManager.getClient('fileSystem');

    // 5. Interact with the servers!
    if (memory) {
      console.log('\n🧠 Querying Memory Server...');
      const memTools = await memory.listTools();
      console.log('Memory Tools:', memTools.map(t => t.name));
      // Example: const result = await memory.callTool('createEntity', { ... });
    }

    if (fs) {
      console.log('\n📁 Querying Filesystem Server...');
      const fsResources = await fs.listResources();
      console.log('FS Resources:', fsResources.map(r => r.uri));
      // Example: const content = await fs.readResource('file:///./README.md');
      // console.log('README content length:', content.length);
    }

    // ... Your agent logic here ...

    // 6. Disconnect all servers when done
    console.log('\n🔌 Disconnecting all servers...');
    await mcpManager.disconnectAll();
    console.log('✅ Disconnected.');

  } catch (error) {
    console.error('❌ MCP Manager Error:', error);
  }
}

run();
```

## ⚙️ Configuring Servers

Adding new MCP servers is straightforward. Just update the `ManagerConfig` object passed to the `manager` function.

The `ManagerConfig` is an object where keys are your chosen **server names** (e.g., `memoryServer`, `myApiTool`) and values are `ServerConfig` objects.

Each `ServerConfig` requires a `transport` property:

### `stdio` Transport

Use this for MCP servers running as local processes that communicate via `stdin`/`stdout`.

```typescript
import type { ManagerConfig } from 'mcp-client-plugin';

const config: ManagerConfig = {
  myStdioServer: {
    transport: {
      type: 'stdio',
      command: 'bun', // The command to execute (e.g., 'bun', 'node', 'python', 'my_server_binary')
      args: ['run', 'start-mcp-server.js', '--port', '8080'], // Arguments for the command
      env: { // Optional: Environment variables for the process
        API_KEY: Bun.env.MY_API_KEY,
        LOG_LEVEL: 'debug',
      },
      cwd: '/path/to/server/working/directory', // Optional: Working directory
    },
    // requiredCapabilities: { ... } // Optional: Specify expected capabilities
  },
  // ... other servers
};
```

### `sse` Transport

Use this for MCP servers accessible via HTTP, using Server-Sent Events for server-to-client communication and HTTP POST for client-to-server requests.

```typescript
import type { ManagerConfig } from 'mcp-client-plugin';

const config: ManagerConfig = {
  myRemoteServer: {
    transport: {
      type: 'sse',
      // The *single* URL for both the SSE connection and POST requests
      url: 'https://my-mcp-server.com/api/mcp',
      headers: { // Optional: Headers for both SSE connection and POST requests
        'Authorization': `Bearer ${Bun.env.REMOTE_API_TOKEN}`,
        'X-Client-Version': '1.0.0',
      },
    },
    // requiredCapabilities: { ... } // Optional
  },
  // ... other servers
};
```

## 📖 API Overview

### `manager(config, options)`

*   Initializes the manager.
*   **`config`**: The `ManagerConfig` object defining your servers.
*   **`options`**: Optional configuration:
    *   `onNotification`: `(serverName, notification) => void` - Callback for handling server-sent notifications.
    *   `requestTimeoutMs`: `number` - Default timeout for requests (default: 30000ms).
*   **Returns**: `Promise<ManagerAPI>` - A promise resolving to the manager API object.

### `ManagerAPI`

The object returned by `manager()` and `.use()`.

*   **.use(serverName: string)**:
    *   Connects to the specified server (spawns process if `stdio`).
    *   Sends `initialize` request.
    *   **Returns**: `Promise<ManagerAPI>` - A *new* ManagerAPI instance representing the updated state, allowing chaining.
*   **.getClient(serverName: string)**:
    *   Retrieves the `ClientAPI` for an already connected server.
    *   **Returns**: `ClientAPI | undefined`.
*   **.getClientAsync(serverName: string)**:
    *   Retrieves the `ClientAPI` for an already connected server, waiting for pending connections.
    *   **Returns**: `Promise<ClientAPI | undefined>`.
*   **.disconnectAll()**:
    *   Disconnects all active clients and terminates their associated processes/connections.
    *   **Returns**: `Promise<void>`.
*   **._getState()**: *Internal use/debugging only*. Returns the current immutable state object.

### `ClientAPI`

The object returned by `manager.getClient()`. Contains methods to interact with a *specific* MCP server.

*   `.getCapabilities()`
    *   Returns the capabilities reported by the server during initialization.
    *   **Returns**: `Record<string, unknown> | undefined`

*   `.callTool(name, params, options?)`
    *   Calls a tool on the server with optional progress tracking.
    *   **Parameters**:
        *   `name: string` - The name of the tool to call.
        *   `params: Record<string, unknown>` - The parameters to pass to the tool.
        *   `options?: { onProgress?: (progress: Progress) => void }` - Optional progress tracking callback.
    *   **Returns**: `Promise<TResult>` - A promise resolving to the tool result.

*   `.listTools()`
    *   Lists tools available on the server.
    *   **Returns**: `Promise<ReadonlyArray<Tool>>` - Array of available tools.

*   `.readResource(uri)`
    *   Reads a resource from the server, returning structured content.
    *   **Parameters**:
        *   `uri: string` - The URI of the resource to read.
    *   **Returns**: `Promise<ReadResourceResult>` - The resource content with metadata.

*   `.listResources()`
    *   Lists resources available on the server.
    *   **Returns**: `Promise<ReadonlyArray<Resource>>` - Array of available resources.

*   `.listPrompts()`
    *   Lists prompts available on the server.
    *   **Returns**: `Promise<ReadonlyArray<Prompt>>` - Array of available prompts.

*   `.getPrompt(name, args?)`
    *   Gets a prompt template with arguments filled in, returning structured messages.
    *   **Parameters**:
        *   `name: string` - The name of the prompt to get.
        *   `args?: Record<string, unknown>` - Optional arguments to fill in the prompt template.
    *   **Returns**: `Promise<GetPromptResult>` - The prompt with filled arguments and message structure.

*   `.listResourceTemplates()`
    *   Lists resource templates available on the server.
    *   **Parameters**: None
    *   **Returns**: `Promise<ReadonlyArray<ResourceTemplate>>` - Array of available resource templates.

*   `.complete(params)`
    *   Completes an argument for a prompt, providing autocompletion suggestions.
    *   **Parameters**:
        *   `params: { ref: { type: string; name: string }; argument: { name: string; value: string } }` - Reference to the prompt and argument to complete.
    *   **Returns**: `Promise<CompleteResult>` - Completion suggestions as an array of values.

*   `.setLoggingLevel(level)`
    *   Sets the logging level for the server, controlling verbosity of log messages.
    *   **Parameters**:
        *   `level: LoggingLevel` - One of 'debug', 'info', 'warning', or 'error'.
    *   **Returns**: `Promise<void>`

*   `.ping()`
    *   Checks connectivity with the server.
    *   **Returns**: `Promise<void>`

*   `.disconnect()`
    *   Disconnects this specific client and terminates its server process/connection.
    *   **Returns**: `Promise<void>`

*(Refer to `src/types.ts` for detailed parameter and return types)*

## 🔔 Handling Notifications

Provide an `onNotification` callback in the `manager` options to react to notifications sent by servers (e.g., `$/progress`, resource changes).

```typescript
const handleNotifications: NotificationHandler = (serverName, notification) => {
  if (notification.method === '$/progress') {
    console.log(`Progress from ${serverName}:`, notification.params);
  } else if (notification.method === 'notifications/message') {
    console.log(`Log from ${serverName}:`, notification.params);
  } else {
    console.log(`Notification [${serverName}]: ${notification.method}`);
  }
};
```

## 📝 Examples

### Tracking Progress for Long-Running Tools

```typescript
const mcpManager = await manager(config)
  .use('memoryServer');

const memory = mcpManager.getClient('memoryServer');

if (memory) {
  const result = await memory.callTool(
    'longRunningTask', 
    { input: 'some large data' },
    { 
      onProgress: (progress) => {
        console.log(`Progress: ${progress.progress}/${progress.total}`);
      } 
    }
  );
  console.log('Task completed with result:', result);
}
```

### Working with Resource Templates

```typescript
const mcpManager = await manager(config)
  .use('fileSystem');

const fs = mcpManager.getClient('fileSystem');

if (fs) {
  // List available resource templates
  const templates = await fs.listResourceTemplates();
  console.log('Available templates:', templates);
  
  // Read a resource using a templated URI
  const logResource = await fs.readResource('file:///logs/app.log');
  console.log('Log content:', logResource.contents[0].text);
}
```

### Auto-completing Arguments for Prompts

```typescript
const mcpManager = await manager(config)
  .use('promptServer');

const promptClient = mcpManager.getClient('promptServer');

if (promptClient) {
  // Get completion suggestions for a prompt argument
  const completions = await promptClient.complete({
    ref: { type: 'ref/prompt', name: 'countryPoem' },
    argument: { name: 'name', value: 'germ' }
  });
  
  console.log('Suggested completions:', completions.completion.values);
  // Output: Suggested completions: ['Germany']
  
  // Use the completed value to get the prompt
  const prompt = await promptClient.getPrompt('countryPoem', { name: 'Germany' });
  console.log('Prompt messages:', prompt.messages);
}
```

### Setting Logging Levels

```typescript
const mcpManager = await manager(config, {
  onNotification: (serverName, notification) => {
    if (notification.method === 'notifications/message') {
      const { level, message } = notification.params;
      console.log(`[${level}] ${serverName}: ${message}`);
    }
  }
}).use('debugServer');

const debug = mcpManager.getClient('debugServer');

if (debug) {
  // Set the logging level to receive more detailed logs
  await debug.setLoggingLevel('debug');
  
  // Now the server will send debug-level log messages
  // which will be captured by the onNotification handler
}
```

## ⏳ Timeouts & Error Handling

*   Requests automatically time out based on `requestTimeoutMs` in options.
*   Errors during connection, communication, or from the server will reject the corresponding promises (e.g., `.use()`, `.callTool()`).
*   Use standard `try...catch` blocks around `await` calls.
*   Unhandled transport or process errors are logged to the console. Implement robust error handling appropriate for your application.

## 🙌 Contributing

Contributions are welcome! Feel free to open issues or submit Pull Requests.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

