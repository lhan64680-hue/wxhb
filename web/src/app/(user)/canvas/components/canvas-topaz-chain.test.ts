import assert from "node:assert/strict";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../types";
import { buildCanvasResourceReferences } from "../utils/canvas-resource-references";
import { buildNodeGenerationInputs } from "./canvas-node-generation";
import { normalizeConnection } from "../utils/canvas-node-connections";

function videoNode(id: string, type: CanvasNodeType, content?: string): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content, status: content ? "success" : "idle", mimeType: "video/mp4", naturalWidth: 1920, naturalHeight: 1080 } };
}

const nodes = [
    videoNode("original", CanvasNodeType.Video, "/original.mp4"),
    videoNode("pass1", CanvasNodeType.TopazVideo, "/api/local-topaz-video/files/pass1"),
    videoNode("pass2", CanvasNodeType.TopazVideo, "/api/local-topaz-video/files/pass2"),
    videoNode("pass3", CanvasNodeType.TopazVideo),
];
const connections: CanvasConnection[] = [
    { id: "original-pass1", fromNodeId: "original", toNodeId: "pass1" },
    { id: "pass1-pass2", fromNodeId: "pass1", toNodeId: "pass2" },
    { id: "pass2-pass3", fromNodeId: "pass2", toNodeId: "pass3" },
];

assert.equal(buildNodeGenerationInputs("pass1", nodes, connections)[0]?.video?.url, "/original.mp4");
for (const [target, source] of [["pass2", "pass1"], ["pass3", "pass2"]]) {
    const inputs = buildNodeGenerationInputs(target, nodes, connections);
    assert.equal(inputs.length, 1, `${target} must receive the preceding Topaz output`);
    assert.equal(inputs[0].nodeId, source, "Do not reuse the original video or an earlier pass");
    assert.equal(inputs[0].video?.url, `/api/local-topaz-video/files/${source}`);
    assert.equal(inputs[0].video?.width, 1920);
}
const references = buildCanvasResourceReferences(nodes, connections, "pass3");
assert.equal(references.find((item) => item.nodeId === "pass2")?.kind, "video");
assert.equal(references.find((item) => item.nodeId === "pass2")?.active, true);
assert.equal(references.some((item) => item.nodeId === "pass3"), false, "Unfinished Topaz nodes are not video resources");
assert.deepEqual(buildNodeGenerationInputs("pass2", nodes.map((node) => node.id === "pass1" ? { ...node, metadata: { status: "loading" } } : node), connections), []);

const configNodes = [...nodes, videoNode("consumer", CanvasNodeType.Video), videoNode("config", CanvasNodeType.Config)];
assert.equal(buildNodeGenerationInputs("consumer", configNodes, [
    { id: "c1", fromNodeId: "consumer", toNodeId: "config" },
    { id: "c2", fromNodeId: "pass2", toNodeId: "config" },
])[0]?.video?.url, "/api/local-topaz-video/files/pass2");

const expected = { fromNodeId: "pass1", toNodeId: "pass2" };
assert.deepEqual(normalizeConnection("pass1", "pass2", nodes, "source"), expected);
assert.deepEqual(normalizeConnection("pass2", "pass1", nodes, "target"), expected, "Dragging backwards from an input must not reverse the data flow");
assert.equal(normalizeConnection("pass1", "pass1", nodes, "source"), null);
assert.equal(normalizeConnection("missing", "pass1", nodes, "source"), null);
const specialNodes = [...configNodes, videoNode("group", CanvasNodeType.Group), videoNode("director", CanvasNodeType.Director), videoNode("image", CanvasNodeType.Image), videoNode("config2", CanvasNodeType.Config)];
assert.equal(normalizeConnection("pass1", "group", specialNodes, "source"), null);
assert.equal(normalizeConnection("pass1", "director", specialNodes, "source"), null);
assert.equal(normalizeConnection("config", "config2", specialNodes, "source"), null);
assert.deepEqual(normalizeConnection("config", "pass1", specialNodes, "target"), { fromNodeId: "pass1", toNodeId: "config" });
assert.deepEqual(normalizeConnection("image", "director", specialNodes, "source"), { fromNodeId: "image", toNodeId: "director" });

console.log("PASS: chained Topaz inputs, nearest output, references, unfinished input, forward/reverse connections and existing restrictions");
