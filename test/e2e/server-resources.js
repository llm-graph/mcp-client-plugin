
import { createMockServer } from "./sdk-mock.js";

const server = createMockServer({
  name: "ResourceServer",
  resources: [
    {
      uri: "resource:///test",
      name: "test",
      content: "This is test resource content"
    }
  ]
});

// Keep the process running
process.stdin.resume();
