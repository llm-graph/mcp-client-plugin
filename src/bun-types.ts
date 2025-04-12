/**
 * This file contains type definitions to improve compatibility between Bun and standard web APIs
 */

// Custom EventSource type compatible with both DOM and Bun
export interface EventSourceCompatible {
  close?: () => void;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  onopen?: ((event: any) => void) | null;
  onmessage?: ((event: any) => void) | null;
  onerror?: ((event: any) => void) | null;
}

// A reader type that's compatible with both Bun and standard web streams
export interface ReaderCompatible<T> {
  read(): Promise<{ done: boolean; value: T | undefined }>;
  cancel(): Promise<void>;
  releaseLock(): void;
  // Optional Bun-specific method
  readMany?: () => any;
} 