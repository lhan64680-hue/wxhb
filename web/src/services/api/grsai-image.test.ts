import assert from "node:assert/strict";
import { grsaiDrawEndpoint, grsaiImageParameters } from "./grsai-image.js";
import { compareImageCredits } from "./grsai-billing.js";

for (const model of ["nano-banana-2.1", "nano-banana-2", "nano-banana-fast", "nano-banana-2-lite"]) {
    assert.equal(grsaiDrawEndpoint(model), "/draw/nano-banana");
    assert.deepEqual(grsaiImageParameters({ model, size: "1:1", quality: "auto" }), { aspectRatio: "1:1", imageSize: "1K" });
}
for (const model of ["gpt-image-2", "gpt-image-2.5"]) {
    assert.equal(grsaiDrawEndpoint(model), "/draw/completions");
    assert.deepEqual(grsaiImageParameters({ model, size: "1:1", quality: "high" }), { aspectRatio: "1024x1024", quality: "auto" });
    assert.deepEqual(grsaiImageParameters({ model, size: "2048x1152", quality: "medium" }), { aspectRatio: "1672x941", quality: "auto" });
}
assert.deepEqual(grsaiImageParameters({ model: "nano-banana-2", size: "2048x1152", quality: "low" }), { aspectRatio: "16:9", imageSize: "2K" });
assert.deepEqual(grsaiImageParameters({ model: "nano-banana-2.1", size: "4:1", quality: "high" }), { aspectRatio: "4:1", imageSize: "4K" });
assert.deepEqual(grsaiImageParameters({ model: "nano-banana-fast", size: "16:9", quality: "high" }), { aspectRatio: "16:9", imageSize: "1K" });
assert.deepEqual(grsaiImageParameters({ model: "nano-banana-2-lite", size: "auto", quality: "medium" }), { aspectRatio: "auto", imageSize: "1K" });
assert.throws(() => grsaiImageParameters({ model: "nano-banana-fast", size: "4:1", quality: "auto" }), /不支持/);
assert.equal(grsaiImageParameters({ model: "gpt-image-2-vip", size: "2048x2048", quality: "medium" }), undefined, "unrequested models must keep their existing parameters");
const models = [{ name: "fast", credits: 440 }, { name: "unknown", credits: null }, { name: "2.1", credits: 1200 }, { name: "gpt", credits: 600 }, { name: "2", credits: 1200 }, { name: "lite", credits: 440 }, { name: "free", credits: 0 }];
assert.deepEqual([...models].sort((a, b) => compareImageCredits(a.credits, b.credits)).map((item) => item.name), ["2.1", "2", "gpt", "fast", "lite", "free", "unknown"]);
assert.equal(models[0].name, "fast", "sorting must not mutate the provider catalog");
console.log("GRS model endpoints, parameters and descending prices: ok");
