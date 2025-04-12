import { describe, test, expect } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig, NotificationHandler } from "../../src/types";

describe("Notification Handling", () => {
  test("onNotification Handler: Called for notifications from stdio server", async () => {
    const notificationServerPath = Bun.fileURLToPath(new URL("../helpers/notification-server.ts", import.meta.url));

    // Create a mock notification handler that captures arguments
    let capturedServerName = "";
    let handlerCalled = false;
    
    const mockHandler: NotificationHandler = (serverName, _notification) => {
      handlerCalled = true;
      capturedServerName = serverName;
    };
    
    const config: ManagerConfig = {
      notifyServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [notificationServerPath],
        },
      },
    };

    const managerApi = manager(config, {
      onNotification: mockHandler,
    });
    
    try {
      // Connect to the server
      const result = await managerApi.use("notifyServer");
      const client = result.getClient("notifyServer");
      expect(client).toBeDefined();
      
      if (client) {
        // Trigger a notification - our test server should send a notification
        // when we call the ping method
        await client.ping();
        
        // Wait a small amount of time for the notification to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Verify that our handler was called at least once
        expect(handlerCalled).toBe(true);
        
        // Verify that the handler was called with the correct server name
        expect(capturedServerName).toBe("notifyServer");
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });

  test("onNotification Handler: Not called if no handler provided", async () => {
    const notificationServerPath = Bun.fileURLToPath(new URL("../helpers/notification-server.ts", import.meta.url));
    
    // Create a spy we can use to verify the default handler is not erroring
    let errorMessages: string[] = [];
    const originalConsoleError = console.error;
    console.error = (message: any) => {
      if (typeof message === 'string') {
        errorMessages.push(message);
      }
    };
    
    const config: ManagerConfig = {
      notifyServer: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [notificationServerPath],
        },
      },
    };

    // No notification handler provided
    const managerApi = manager(config);
    
    try {
      // Connect to the server
      const result = await managerApi.use("notifyServer");
      const client = result.getClient("notifyServer");
      expect(client).toBeDefined();
      
      if (client) {
        // Trigger a notification
        await client.ping();
        
        // Wait a small amount of time for the notification to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // There should be no errors in the console related to notification handling
        const hasNotificationError = errorMessages.some(
          message => message.includes("notification handler")
        );
        expect(hasNotificationError).toBe(false);
      }
    } finally {
      await managerApi.disconnectAll();
      console.error = originalConsoleError;
    }
  });

  test("onNotification Handler: Handles multiple notifications from different servers", async () => {
    const notificationServerPath = Bun.fileURLToPath(new URL("../helpers/notification-server.ts", import.meta.url));

    // Create a notification handler that tracks server names
    const receivedNotifications: { serverName: string; method: string }[] = [];
    
    const mockHandler: NotificationHandler = (serverName, notification) => {
      receivedNotifications.push({
        serverName: serverName,
        method: notification.method
      });
    };
    
    const config: ManagerConfig = {
      server1: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [notificationServerPath, "--server-name=server1"],
        },
      },
      server2: {
        transport: {
          type: "stdio",
          command: "bun",
          args: [notificationServerPath, "--server-name=server2"],
        },
      },
    };

    const managerApi = manager(config, {
      onNotification: mockHandler,
    });
    
    try {
      // Connect to both servers
      const result = await managerApi.use("server1").then(m => m.use("server2"));
      
      const client1 = result.getClient("server1");
      const client2 = result.getClient("server2");
      
      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
      
      if (client1 && client2) {
        // Trigger notifications from both servers
        await client1.ping();
        await client2.ping();
        
        // Wait a small amount of time for notifications to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Verify that our handler was called at least twice
        expect(receivedNotifications.length).toBeGreaterThanOrEqual(2);
        
        // Verify that the handler was called with both server names
        const server1Notifications = receivedNotifications.filter(n => n.serverName === "server1");
        const server2Notifications = receivedNotifications.filter(n => n.serverName === "server2");
        
        expect(server1Notifications.length).toBeGreaterThan(0);
        expect(server2Notifications.length).toBeGreaterThan(0);
      }
    } finally {
      await managerApi.disconnectAll();
    }
  });
}); 