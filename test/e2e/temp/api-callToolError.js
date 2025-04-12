
    const responses = {"initialize":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"capabilities\":{\"tools\":{}}}}","tools/call":"{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32000,\"message\":\"Tool execution failed\"}}"};
    
    // Handle process termination
    process.on('SIGTERM', () => {
      process.exit(0);
    });
    
    process.stdin.on("data", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const method = message.method;
        const id = message.id;
        
        if (method === "initialize") {
          // Always respond to initialize
          process.stdout.write(responses["initialize"] + "\n");
          process.stdout.write('{"jsonrpc":"2.0","method":"initialized"}\n');
          return;
        }
        
        if (responses[method]) {
          // Replace the ID in the response with the request ID
          const response = responses[method].replace(/"id":\s*\d+/, '"id": ' + id);
          process.stdout.write(response + "\n");
        } else {
          // Method not found error
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: "Method not found: " + method
            }
          }) + "\n");
        }
      } catch (error) {
        // Parse error
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error"
          }
        }) + "\n");
      }
    });
    
    // Keep the process running
    setInterval(() => {}, 1000);
  