
import { createMockServer } from "./sdk-mock.js";

const server = createMockServer({
  name: "ToolsServer",
  tools: [
    {
      name: "test-tool",
      description: "A test tool",
      params: { arg: "string" },
      result: { output: "test output" }
    }
  ]
});

// Keep the process running
process.stdin.resume();
