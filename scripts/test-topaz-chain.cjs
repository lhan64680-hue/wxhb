// Run with: node scripts/test-topaz-chain.cjs (uses the installed web TypeScript).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'web/node_modules/typescript'));
const cache = new Map();
const overrides = new Map();

function load(file) {
    file = path.resolve(file);
    if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function('require', 'exports', 'module', code)((name) => {
        if (overrides.has(name)) return overrides.get(name);
        if (name.startsWith('node:')) return require(name);
        if (name.startsWith('@/')) return load(path.join(root, 'web/src', name.slice(2)));
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
        throw new Error(`Unexpected dependency: ${name}`);
    }, mod.exports, mod);
    return mod.exports;
}

async function main() {
    load(path.join(root, 'web/src/app/(user)/canvas/components/canvas-topaz-chain.test.ts'));
    let submitted, mediaError = false;
    const requested = [];
    overrides.set('@/services/api/request', { apiPost: async (url, body) => { submitted = body; return { id: 'pass2' }; } });
    overrides.set('@/services/image-storage', { getProxyUrl: (url) => url });
    overrides.set('@/services/file-storage', { resolveMediaUrl: async (key, url) => url, getMediaBlob: async () => null });
    const saved = new Map(['document', 'window', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        globalThis.window = { setTimeout, clearTimeout };
        globalThis.document = { createElement: () => ({
            videoWidth: 3888, videoHeight: 2160, duration: 5.22,
            set src(value) { queueMicrotask(() => mediaError ? this.onerror() : this.onloadedmetadata()); },
        }) };
        globalThis.fetch = async (url) => {
            requested.push(url);
            return url.endsWith('/uploads')
                ? Response.json({ code: 0, data: { id: 'uploaded-pass1' } })
                : new Response(new Blob(['video fixture'], { type: 'video/mp4' }));
        };
        const { createTopazVideoTask } = load(path.join(root, 'web/src/services/api/topaz-video.ts'));
        const source = { url: '/api/local-topaz-video/files/pass1', width: 864, height: 480, durationMs: 74181 };
        const options = { model: 'prob-4', target: '1080p', quality: 'balanced', interpolation: 'none', slowdown: '1x' };
        await createTopazVideoTask(source, options);
        assert.equal(requested[0], source.url, 'Read the previous Topaz result');
        assert.equal(submitted.inputId, 'uploaded-pass1');
        assert.equal(submitted.sourceWidth, 3888, 'Read actual output dimensions');
        assert.equal(submitted.sourceHeight, 2160);
        assert.equal(submitted.sourceDurationMs, 5220, 'Use playback duration, never the previous generation time');
        submitted = undefined;
        mediaError = true;
        await assert.rejects(createTopazVideoTask(source, options), /无法读取输入视频信息/);
        assert.equal(submitted, undefined, 'Do not launch a task with unreadable media');
        console.log('PASS: Topaz output upload, real media duration/dimensions and unreadable input');
    } finally {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
