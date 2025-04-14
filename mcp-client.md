This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.
The content has been processed where comments have been removed, empty lines have been removed, security check has been disabled.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: .github/**
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Code comments have been removed from supported file types
- Empty lines have been removed from all files
- Security check has been disabled - content may contain sensitive information
- Files are sorted by Git change count (files with more changes are at the bottom)

## Additional Info

# Directory Structure
```
src/
  MCPClient.test.ts
  MCPClient.ts
.gitignore
eslint.config.js
jsr.json
LICENSE
package.json
README.md
tsconfig.json
```

# Files

## File: src/MCPClient.test.ts
````typescript
import { MCPClient, ErrorCode, McpError } from "./MCPClient.js";
import { z } from "zod";
import { test, expect, expectTypeOf, vi } from "vitest";
import { getRandomPort } from "get-port-please";
import { FastMCP, FastMCPSession } from "fastmcp";
import { setTimeout as delay } from "timers/promises";
const runWithTestServer = async ({
  run,
  client: createClient,
  server: createServer,
}: {
  server?: () => Promise<FastMCP>;
  client?: () => Promise<MCPClient>;
  run: ({
    server,
    client,
    session,
  }: {
    server: FastMCP;
    client: MCPClient;
    session: FastMCPSession;
  }) => Promise<void>;
}) => {
  const port = await getRandomPort();
  const server = createServer
    ? await createServer()
    : new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
  await server.start({
    transportType: "sse",
    sse: {
      endpoint: "/sse",
      port,
    },
  });
  const sseUrl = `http://localhost:${port}/sse`;
  try {
    const client = createClient
      ? await createClient()
      : new MCPClient(
          {
            name: "example-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );
    const [session] = await Promise.all([
      new Promise<FastMCPSession>((resolve) => {
        server.on("connect", (event) => {
          resolve(event.session);
        });
      }),
      client.connect({ url: sseUrl, type: "sse" }),
    ]);
    await run({ server, client, session });
  } finally {
    await server.stop();
  }
  return port;
};
test("closes a connection", async () => {
  await runWithTestServer({
    run: async ({ client }) => {
      await client.close();
    },
  });
});
test("pings a server", async () => {
  await runWithTestServer({
    run: async ({ client }) => {
      await expect(client.ping()).resolves.toBeNull();
    },
  });
});
test("gets tools", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args) => {
          return String(args.a + args.b);
        },
      });
      return server;
    },
    run: async ({ client }) => {
      const tools = await client.getAllTools();
      expect(tools).toEqual([
        {
          description: "Add two numbers",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            additionalProperties: false,
            properties: {
              a: {
                type: "number",
              },
              b: {
                type: "number",
              },
            },
            required: ["a", "b"],
            type: "object",
          },
          name: "add",
        },
      ]);
    },
  });
});
test("calls a tool", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args) => {
          return String(args.a + args.b);
        },
      });
      return server;
    },
    run: async ({ client }) => {
      await expect(
        client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).resolves.toEqual({
        content: [{ type: "text", text: "3" }],
      });
    },
  });
});
test("calls a tool with a custom result schema", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args) => {
          return String(args.a + args.b);
        },
      });
      return server;
    },
    run: async ({ client }) => {
      const result = await client.callTool(
        {
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        },
        {
          resultSchema: z.object({
            content: z.array(
              z.object({
                type: z.literal("text"),
                text: z.string(),
              }),
            ),
          }),
        },
      );
      expectTypeOf(result).toEqualTypeOf<{
        content: { type: "text"; text: string }[];
      }>();
    },
  });
});
test("handles errors", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async () => {
          throw new Error("Something went wrong");
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        }),
      ).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Something went wrong"),
          },
        ],
        isError: true,
      });
    },
  });
});
test("calling an unknown tool throws McpError with MethodNotFound code", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      return server;
    },
    run: async ({ client }) => {
      try {
        await client.callTool({
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        });
      } catch (error) {
        console.log(error);
        expect(error).toBeInstanceOf(McpError);
        expect(error.code).toBe(ErrorCode.MethodNotFound);
      }
    },
  });
});
test("tracks tool progress", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args, { reportProgress }) => {
          reportProgress({
            progress: 0,
            total: 10,
          });
          await delay(100);
          return String(args.a + args.b);
        },
      });
      return server;
    },
    run: async ({ client }) => {
      const onProgress = vi.fn();
      await client.callTool(
        {
          name: "add",
          arguments: {
            a: 1,
            b: 2,
          },
        },
        {
          requestOptions: {
            onProgress,
          },
        },
      );
      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith({
        progress: 0,
        total: 10,
      });
    },
  });
});
test("sets logging levels", async () => {
  await runWithTestServer({
    run: async ({ client, session }) => {
      await client.setLoggingLevel("debug");
      expect(session.loggingLevel).toBe("debug");
      await client.setLoggingLevel("info");
      expect(session.loggingLevel).toBe("info");
    },
  });
});
test("sends logging messages to the client", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addTool({
        name: "add",
        description: "Add two numbers",
        parameters: z.object({
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args, { log }) => {
          log.debug("debug message", {
            foo: "bar",
          });
          log.error("error message");
          log.info("info message");
          log.warn("warn message");
          return String(args.a + args.b);
        },
      });
      return server;
    },
    run: async ({ client }) => {
      const onLog = vi.fn();
      client.on("loggingMessage", onLog);
      await client.callTool({
        name: "add",
        arguments: {
          a: 1,
          b: 2,
        },
      });
      expect(onLog).toHaveBeenCalledTimes(4);
      expect(onLog).toHaveBeenNthCalledWith(1, {
        level: "debug",
        message: "debug message",
        context: {
          foo: "bar",
        },
      });
      expect(onLog).toHaveBeenNthCalledWith(2, {
        level: "error",
        message: "error message",
      });
      expect(onLog).toHaveBeenNthCalledWith(3, {
        level: "info",
        message: "info message",
      });
      expect(onLog).toHaveBeenNthCalledWith(4, {
        level: "warning",
        message: "warn message",
      });
    },
  });
});
test("adds resources", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return {
            text: "Example log content",
          };
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(await client.getAllResources()).toEqual([
        {
          uri: "file:///logs/app.log",
          name: "Application Logs",
          mimeType: "text/plain",
        },
      ]);
    },
  });
});
test("clients reads a resource", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return {
            text: "Example log content",
          };
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.getResource({
          uri: "file:///logs/app.log",
        }),
      ).toEqual({
        contents: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "Example log content",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});
test("clients reads a resource that returns multiple resources", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addResource({
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain",
        async load() {
          return [
            {
              text: "a",
            },
            {
              text: "b",
            },
          ];
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.getResource({
          uri: "file:///logs/app.log",
        }),
      ).toEqual({
        contents: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "a",
            mimeType: "text/plain",
          },
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            text: "b",
            mimeType: "text/plain",
          },
        ],
      });
    },
  });
});
test("adds prompts", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addPrompt({
        name: "git-commit",
        description: "Generate a Git commit message",
        arguments: [
          {
            name: "changes",
            description: "Git diff or description of changes",
            required: true,
          },
        ],
        load: async (args) => {
          return `Generate a concise but descriptive commit message for these changes:\n\n${args.changes}`;
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(
        await client.getPrompt({
          name: "git-commit",
          arguments: {
            changes: "foo",
          },
        }),
      ).toEqual({
        description: "Generate a Git commit message",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Generate a concise but descriptive commit message for these changes:\n\nfoo",
            },
          },
        ],
      });
      expect(await client.getAllPrompts()).toEqual([
        {
          name: "git-commit",
          description: "Generate a Git commit message",
          arguments: [
            {
              name: "changes",
              description: "Git diff or description of changes",
              required: true,
            },
          ],
        },
      ]);
    },
  });
});
test("completes prompt arguments", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addPrompt({
        name: "countryPoem",
        description: "Writes a poem about a country",
        load: async ({ name }) => {
          return `Hello, ${name}!`;
        },
        arguments: [
          {
            name: "name",
            description: "Name of the country",
            required: true,
            complete: async (value) => {
              if (value === "Germ") {
                return {
                  values: ["Germany"],
                };
              }
              return {
                values: [],
              };
            },
          },
        ],
      });
      return server;
    },
    run: async ({ client }) => {
      const response = await client.complete({
        ref: {
          type: "ref/prompt",
          name: "countryPoem",
        },
        argument: {
          name: "name",
          value: "Germ",
        },
      });
      expect(response).toEqual({
        completion: {
          values: ["Germany"],
        },
      });
    },
  });
});
test("lists resource templates", async () => {
  await runWithTestServer({
    server: async () => {
      const server = new FastMCP({
        name: "Test",
        version: "1.0.0",
      });
      server.addResourceTemplate({
        uriTemplate: "file:///logs/{name}.log",
        name: "Application Logs",
        mimeType: "text/plain",
        arguments: [
          {
            name: "name",
            description: "Name of the log",
            required: true,
          },
        ],
        load: async ({ name }) => {
          return {
            text: `Example log content for ${name}`,
          };
        },
      });
      return server;
    },
    run: async ({ client }) => {
      expect(await client.getAllResourceTemplates()).toEqual([
        {
          name: "Application Logs",
          uriTemplate: "file:///logs/{name}.log",
        },
      ]);
    },
  });
});
````

## File: src/MCPClient.ts
````typescript
import {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CompleteRequest,
  CompleteResult,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  LoggingLevel,
  LoggingMessageNotificationSchema,
  Progress,
  Prompt,
  ReadResourceRequest,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  Tool,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import EventEmitter from "events";
import { z } from "zod";
import { StrictEventEmitter } from "strict-event-emitter-types";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
export { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
type ProgressCallback = (progress: Progress) => void;
type RequestOptions = {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  timeout?: number;
};
const transformRequestOptions = (requestOptions: RequestOptions) => {
  return {
    onprogress: requestOptions.onProgress,
    signal: requestOptions.signal,
    timeout: requestOptions.timeout,
  };
};
type LoggingMessageNotification = {
  [key: string]: unknown;
  level: LoggingLevel;
};
type MCPClientEvents = {
  loggingMessage: (event: LoggingMessageNotification) => void;
};
const MCPClientEventEmitterBase: {
  new (): StrictEventEmitter<EventEmitter, MCPClientEvents>;
} = EventEmitter;
class MCPClientEventEmitter extends MCPClientEventEmitterBase {}
async function fetchAllPages<T>(
  client: any,
  requestParams: { method: string; params?: Record<string, any> },
  schema: any,
  getItems: (response: any) => T[],
  requestOptions?: RequestOptions,
): Promise<T[]> {
  const allItems: T[] = [];
  let cursor: string | undefined;
  do {
    const params = { ...(requestParams.params || {}) };
    if (cursor) {
      params.cursor = cursor;
    }
    const response = await client.request(
      { method: requestParams.method, params },
      schema,
      requestOptions ? transformRequestOptions(requestOptions) : undefined,
    );
    allItems.push(...getItems(response));
    cursor = response.nextCursor;
  } while (cursor);
  return allItems;
}
export class MCPClient extends MCPClientEventEmitter {
  private client: Client;
  private transports: Transport[] = [];
  constructor(clientInfo: Implementation, options?: ClientOptions) {
    super();
    this.client = new Client(clientInfo, options);
    this.client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (message) => {
        if (message.method === "notifications/message") {
          this.emit("loggingMessage", {
            level: message.params.level,
            ...(message.params.data ?? {}),
          });
        }
      },
    );
  }
  async connect(
    options:
      | { type: "sse"; url: string }
      | {
          type: "stdio";
          args: string[];
          command: string;
          env: Record<string, string>;
        },
  ): Promise<void> {
    if (options.type === "sse") {
      const transport = new SSEClientTransport(new URL(options.url));
      this.transports.push(transport);
      await this.client.connect(transport);
    } else if (options.type === "stdio") {
      const transport = new StdioClientTransport({
        command: options.command,
        env: options.env,
        args: options.args,
      });
      this.transports.push(transport);
    } else {
      throw new Error(`Unknown transport type`);
    }
  }
  async ping(options?: { requestOptions?: RequestOptions }): Promise<null> {
    await this.client.ping(options?.requestOptions);
    return null;
  }
  async getAllTools(options?: {
    requestOptions?: RequestOptions;
  }): Promise<Tool[]> {
    return fetchAllPages(
      this.client,
      { method: "tools/list" },
      ListToolsResultSchema,
      (result) => result.tools,
      options?.requestOptions,
    );
  }
  async getAllResources(options?: {
    requestOptions?: RequestOptions;
  }): Promise<Resource[]> {
    return fetchAllPages(
      this.client,
      { method: "resources/list" },
      ListResourcesResultSchema,
      (result) => result.resources,
      options?.requestOptions,
    );
  }
  async getAllPrompts(options?: {
    requestOptions?: RequestOptions;
  }): Promise<Prompt[]> {
    return fetchAllPages(
      this.client,
      { method: "prompts/list" },
      ListPromptsResultSchema,
      (result) => result.prompts,
      options?.requestOptions,
    );
  }
  async callTool<
    TResultSchema extends z.ZodType = z.ZodType<CallToolResult>,
    TResult = z.infer<TResultSchema>,
  >(
    invocation: {
      name: string;
      arguments?: Record<string, unknown>;
    },
    options?: {
      resultSchema?: TResultSchema;
      requestOptions?: RequestOptions;
    },
  ): Promise<TResult> {
    return (await this.client.callTool(
      invocation,
      options?.resultSchema as any,
      options?.requestOptions
        ? transformRequestOptions(options.requestOptions)
        : undefined,
    )) as TResult;
  }
  async complete(
    params: CompleteRequest["params"],
    options?: {
      requestOptions?: RequestOptions;
    },
  ): Promise<CompleteResult> {
    return await this.client.complete(params, options?.requestOptions);
  }
  async getResource(
    params: ReadResourceRequest["params"],
    options?: {
      requestOptions?: RequestOptions;
    },
  ): Promise<ReadResourceResult> {
    return await this.client.readResource(params, options?.requestOptions);
  }
  async getPrompt(
    params: GetPromptRequest["params"],
    options?: {
      requestOptions?: RequestOptions;
    },
  ): Promise<GetPromptResult> {
    return await this.client.getPrompt(params, options?.requestOptions);
  }
  async getAllResourceTemplates(options?: {
    requestOptions?: RequestOptions;
  }): Promise<ResourceTemplate[]> {
    let cursor: string | undefined;
    const allItems: ResourceTemplate[] = [];
    do {
      const response = await this.client.listResourceTemplates(
        { cursor },
        options?.requestOptions,
      );
      allItems.push(...response.resourceTemplates);
      cursor = response.nextCursor;
    } while (cursor);
    return allItems;
  }
  async setLoggingLevel(level: LoggingLevel) {
    await this.client.setLoggingLevel(level);
  }
  async close() {
    for (const transport of this.transports) {
      await transport.close();
    }
  }
}
````

## File: .gitignore
````
dist
node_modules
````

## File: eslint.config.js
````javascript
import perfectionist from "eslint-plugin-perfectionist";
export default [perfectionist.configs["recommended-alphabetical"]];
````

## File: jsr.json
````json
{
  "name": "@glama/mcp-client",
  "version": "1.0.0",
  "exports": "./src/MCPClient.ts",
  "include": ["src/MCPClient.ts"]
}
````

## File: LICENSE
````
The MIT License (MIT)
=====================

Copyright © 2025 Frank Fiegel (frank@glama.ai)

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the “Software”), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
````

## File: package.json
````json
{
  "name": "mcp-client",
  "version": "1.0.0",
  "main": "dist/MCPClient.js",
  "scripts": {
    "build": "tsup",
    "test": "vitest run && tsc && jsr publish --dry-run --allow-dirty",
    "format": "prettier --write . && eslint --fix ."
  },
  "keywords": [
    "MCP",
    "Client",
    "EventSource",
    "SSE"
  ],
  "type": "module",
  "author": "Frank Fiegel <frank@glama.ai>",
  "license": "MIT",
  "description": "An MCP client for Node.js",
  "module": "dist/MCPClient.js",
  "types": "dist/MCPClient.d.ts",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "reconnecting-eventsource": "^1.6.4",
    "strict-event-emitter-types": "^2.0.0",
    "zod": "^3.24.2"
  },
  "repository": {
    "url": "https://github.com/punkpeye/mcp-client"
  },
  "homepage": "https://glama.ai/mcp",
  "release": {
    "branches": [
      "main"
    ],
    "plugins": [
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "@semantic-release/npm",
      "@semantic-release/github",
      "@sebbo2002/semantic-release-jsr"
    ]
  },
  "devDependencies": {
    "@sebbo2002/semantic-release-jsr": "^2.0.4",
    "@tsconfig/node22": "^22.0.0",
    "@types/node": "^22.13.10",
    "@types/uri-templates": "^0.1.34",
    "@types/yargs": "^17.0.33",
    "eslint": "^9.22.0",
    "eslint-plugin-perfectionist": "^4.10.1",
    "eventsource-client": "^1.1.3",
    "fastmcp": "^1.20.4",
    "get-port-please": "^3.1.2",
    "jsr": "^0.13.4",
    "prettier": "^3.5.3",
    "semantic-release": "^24.2.3",
    "tsup": "^8.4.0",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  },
  "tsup": {
    "entry": [
      "src/MCPClient.ts"
    ],
    "format": [
      "esm"
    ],
    "dts": true,
    "splitting": true,
    "sourcemap": true,
    "clean": true
  }
}
````

## File: README.md
````markdown
# MCP Client

An [MCP](https://glama.ai/blog/2024-11-25-model-context-protocol-quickstart) client for Node.js.

> [!TIP]
> This client has been tested with [FastMCP](https://github.com/punkpeye/fastmcp).

## Why?

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) provides a client for the MCP protocol, but it's a little verbose for my taste. This client abstracts away some of the lower-level details (like pagination, Zod schemas, etc.) and provides a more convenient API.
- The MCP protocol follows some REST-like naming conventions, like `listTools` and `readResource`, but those names look a bit awkward in TypeScript. This client uses more typical method names, like `getTools` and `getResource`.

## Usage

### Creating a client

```ts
import { MCPClient } from "mcp-client";

const client = new MCPClient({
  name: "Test",
  version: "1.0.0",
});
```

### Connecting using `stdio`

```ts
await client.connect({
  type: "stdio",
  args: ["--port", "8080"],
  command: "node",
  env: {
    PORT: "8080",
  },
});
```

### Connecting using SSE

```ts
await client.connect({
  type: "sse",
  url: "http://localhost:8080/sse",
});
```

### Pinging the server

```ts
await client.ping();
```

### Calling a tool

```ts
const result = await client.callTool({
  name: "add",
  arguments: { a: 1, b: 2 },
});
```

### Calling a tool with a custom result schema

```ts
const result = await client.callTool(
  {
    name: "add",
    arguments: { a: 1, b: 2 },
  },
  {
    resultSchema: z.object({
      content: z.array(
        z.object({
          type: z.literal("text"),
          text: z.string(),
        }),
      ),
    }),
  },
);
```

### Listing tools

```ts
const tools = await client.getAllTools();
```

### Listing resources

```ts
const resources = await client.getAllResources();
```

### Reading a resource

```ts
const resource = await client.getResource({ uri: "file:///logs/app.log" });
```

### Getting a prompt

```ts
const prompt = await client.getPrompt({ name: "git-commit" });
```

### Listing prompts

```ts
const prompts = await client.getAllPrompts();
```

### Setting the logging level

```ts
await client.setLoggingLevel("debug");
```

### Completing a prompt

```ts
const result = await client.complete({
  ref: { type: "ref/prompt", name: "git-commit" },
  argument: { name: "changes", value: "Add a new feature" },
});
```

### Listing resource templates

```ts
const resourceTemplates = await client.getAllResourceTemplates();
```

### Receiving logging messages

```ts
client.on("loggingMessage", (message) => {
  console.log(message);
});
```

> [!NOTE]
> Equivalent to `setNotificationHandler(LoggingMessageNotificationSchema, (message) => { ... })` in the MCP TypeScript SDK.
````

## File: tsconfig.json
````json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
````
