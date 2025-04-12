import { describe, expect, test } from "bun:test";
import { manager } from "../../src/core";
import type { ManagerConfig } from "../../src/types";

describe("Manager Basic Tests", () => {
  test("Manager initialization with empty config", () => {
    const config: ManagerConfig = {};
    const mgr = manager(config);
    
    expect(mgr).toBeDefined();
    expect(typeof mgr.use).toBe("function");
    expect(typeof mgr.getClient).toBe("function");
  });
  
  test("Manager exposes the expected API", () => {
    const config: ManagerConfig = {};
    const mgr = manager(config);
    
    // Check that it has all the expected API methods
    expect(mgr).toHaveProperty("use");
    expect(mgr).toHaveProperty("getClient");
    expect(mgr).toHaveProperty("getClientAsync");
    expect(mgr).toHaveProperty("disconnectAll");
    expect(mgr).toHaveProperty("_getState");
    
    // Check that the methods have the expected types
    expect(typeof mgr.use).toBe("function");
    expect(typeof mgr.getClient).toBe("function");
    expect(typeof mgr.getClientAsync).toBe("function");
    expect(typeof mgr.disconnectAll).toBe("function");
    expect(typeof mgr._getState).toBe("function");
  });
  
  test("Manager.getClient() returns undefined for non-existent server", () => {
    const config: ManagerConfig = {};
    const mgr = manager(config);
    
    const client = mgr.getClient("non-existent-server");
    expect(client).toBeUndefined();
  });
}); 