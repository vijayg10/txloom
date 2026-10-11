import { tsImport } from "tsx/esm/api";

// Same reason as ../pool/worker-entry.mjs: a worker thread's plain `import()` cannot parse
// TypeScript, so load the real module through tsx's `tsImport` API from this .mjs file.
await tsImport(new URL("./live-world-thread.ts", import.meta.url).href, import.meta.url);
