import assert from "node:assert/strict";

import { shouldStopLocalImageTaskWithoutResult } from "./canvas-local-image-task.js";

const common = { hasContent: false, isLocalTransport: true, status: "loading" } as const;

// A live local request can report 100% before its result body is available.
// It must remain in the browser-owned request loop rather than become an error.
assert.equal(shouldStopLocalImageTaskWithoutResult({ ...common, isRestoring: false, progress: 100 }), false);

// After a page reload, the browser-owned request loop no longer exists.
assert.equal(shouldStopLocalImageTaskWithoutResult({ ...common, isRestoring: true, progress: 0 }), true);

console.log("canvas local image task lifecycle: ok");
