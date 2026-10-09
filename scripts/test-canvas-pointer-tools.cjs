// Exercise the real canvas pointer handlers without a browser or external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'web/node_modules/typescript'));
const react = require(path.join(root, 'web/node_modules/react'));
const jsx = require(path.join(root, 'web/node_modules/react/jsx-runtime'));
class Target {
    constructor(node = false, control = false, input = false) { this.node = node; this.control = control; this.input = input; }
    closest(selector) {
        if (this.input && selector.includes('input')) return this;
        if (this.control && selector.includes('[data-canvas-no-zoom]')) return this;
        return this.node && selector.includes('[data-node-id]') ? this : null;
    }
}
global.Element = Target;
global.document = { body: { style: {} } };
function load(file, imports) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => {
        if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
        return imports[name];
    }, module, module.exports);
    return module.exports;
}
let spacePressed = false;
const { InfiniteCanvas } = load('web/src/app/(user)/canvas/components/infinite-canvas.tsx', {
    react: { ...react, useEffect: () => {}, useRef: (value) => ({ current: value }), useState: () => [spacePressed, () => {}] },
    'react/jsx-runtime': jsx,
    '@/lib/canvas-theme': { canvasThemes: { dark: { canvas: { background: '#111' } } } },
    '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'dark' }) },
});
function pointer(tool, { node = false, control = false, input = false, button = 0, ctrlKey = false, space = false } = {}) {
    let selections = 0, stopped = false, captured = false;
    spacePressed = space;
    document.body.style.cursor = '';
    const element = InfiniteCanvas({
        tool, containerRef: { current: null }, viewport: { x: 0, y: 0, k: 1 },
        onViewportChange: () => {}, onCanvasMouseDown: () => selections++,
    });
    const handler = element.props.onPointerDownCapture || element.props.onPointerDown;
    handler({
        target: new Target(node, control, input), button, ctrlKey, clientX: 10, clientY: 20, pointerId: 1,
        currentTarget: { setPointerCapture: () => { captured = true; } },
        preventDefault() {}, stopPropagation() { stopped = true; },
    });
    return { selections, stopped, captured, cursor: document.body.style.cursor };
}
assert.equal(pointer('select').selections, 1, 'Selection tool must marquee-select with an ordinary left drag');
assert.equal(pointer('select', { node: true }).captured, false, 'Node drags must reach their node handler');
assert.equal(pointer('hand').cursor, 'grabbing');
assert.equal(pointer('hand', { node: true }).stopped, true, 'Hand tool must pan without moving nodes');
assert.equal(pointer('hand', { ctrlKey: true }).selections, 1, 'Retain Ctrl+drag marquee shortcut');
assert.equal(pointer('select', { button: 1 }).cursor, 'grabbing', 'Middle button temporarily pans');
assert.equal(pointer('select', { button: 2 }).captured, false, 'Right click must keep the context menu');
assert.equal(pointer('hand', { control: true }).captured, false, 'Do not intercept editable controls');
assert.equal(pointer('hand', { node: true, input: true }).captured, false, 'Title and text editing must remain usable in hand mode');
assert.equal(pointer('select', { space: true }).cursor, 'grabbing', 'Space temporarily pans in selection mode');
assert.equal(pointer('select', { node: true, space: true }).stopped, true, 'Space pans over nodes instead of moving them');
console.log('PASS: selection/hand tools, node dragging, Ctrl marquee, Space/middle-button pan and UI exclusions');
