
import { createMockServer } from "./sdk-mock.js";

const server = createMockServer({
  name: "ToolsServer",
  tools: [
    {
      name: "calculator",
      description: "Perform calculations",
      params: { arg: "string" },
      result: { value: 42 }
    }
  ]
});

// Keep the process running
process.stdin.resume();
