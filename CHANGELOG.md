# Changelog

## [0.2.0] - 2023 - Reliability Improvements

### Added
- New asynchronous `getClientAsync` method to properly wait for pending connections
- Improved connection management with more robust error handling
- Better server connection timeout handling with clearer error messages
- Enhanced test coverage for error handling scenarios

### Fixed
- Fixed issue with async connection handling in `use()` method
- Improved error propagation from server transport errors
- Fixed race conditions in client connection management
- Made tests more robust with proper timeouts and error handling
- Fixed issue where `getClient()` would return undefined when a connection was pending

### Changed
- Made `use()` method properly return a Promise to allow awaiting connection completion
- Simplified E2E tests to focus on core functionality
- Improved error handling in transport creation
- Enhanced stderr reporting from child processes

## [0.1.0] - 2023 - Initial Release

- Initial implementation of the MCP Client Plugin
- Support for stdio and SSE transports
- Basic manager and client APIs
- Type definitions and utilities
- Initial test suite 