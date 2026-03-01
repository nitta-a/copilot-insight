/**
 * Minimal Fetch API ambient declarations required by @modelcontextprotocol/sdk.
 *
 * These types (HeadersInit, Headers) are normally provided by lib.dom.d.ts or
 * the undici module in Node.js 18+.  We declare only what the SDK needs so
 * that lib.dom is not required in the compiler options.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare type HeadersInit =
  | [string, string][]
  | Record<string, string>
  | { forEach(callback: (value: string, name: string) => void): void };
