
    // Setup logging
    const logMessages = [];
    
    process.on('SIGTERM', () => {
      console.error('Received SIGTERM');
      process.exit(0);
    });
    
    process.on('exit', (code) => {
      console.error('Process exiting with code:', code);
    });
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());
        logMessages.push(`Received: ${JSON.stringify(message)}`);
        
        // Handle initialize first
        if (message.method === 'initialize') {
          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              capabilities: {}
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
          process.stdout.write('{"jsonrpc":"2.0","method":"initialized"}\n');
          return;
        }
        
        // Handle the specific method
        if (message.method === 'tools/list') {
          // Replace the ID in the response with the request ID
          const response = '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"simple-tool","inputSchema":{}}]}}'.replace(/"id":\s*\d+/, '"id": ' + message.id);
          process.stdout.write(response + '\n');
          return;
        }
        
        // Method not supported
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Method ${message.method} not supported`
          }
        }) + '\n');
      } catch (error) {
        console.error('Error handling input:', error);
        
        // Parse error response
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }) + '\n');
      }
    });
    
    // Keep alive
    setInterval(() => {}, 1000);
  