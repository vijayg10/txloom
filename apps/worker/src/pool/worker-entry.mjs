import { tsImport } from "tsx/esm/api";

// Piscina's worker runtime loads `filename` with a plain `import()`, which can't
// parse `.ts` directly, and passing `--import tsx` via `execArgv` loses the race
// against that load (the loader hook doesn't finish registering in time). Loading
// this plain .mjs file first, then using tsx's own `tsImport` API to pull in the
// real (TypeScript) worker module, sidesteps the race entirely.
const mod = await tsImport(new URL("./partition-worker.ts", import.meta.url).href, import.meta.url);

export default mod.default;
