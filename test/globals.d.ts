/// <reference types="bun-types" />

declare global {
  export const {
    describe,
    test,
    expect,
    beforeAll,
    beforeEach,
    afterAll,
    afterEach
  } = await import('bun:test')
}

export {}; 