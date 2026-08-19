# Third-party notices

## MiniMax-H3 Turbo LoRA and ComfyUI nodes

This project packages the minimal runtime files required by the local MiniMax-H3 Turbo integration:

- `larryvrh/MiniMax-H3-Turbo-Lora`, `minimax_h3_turbo_v4_step600_ema.safetensors` (Apache-2.0). Deployment verifies SHA-256 `5f3a626cd72c93a8b9318d6760c510bc5092d2ab13aaba1f932c5bab07a416d3` before enabling Turbo mode.
- `Larryvrh/ComfyUI-MiniMax-H3-Turbo` custom node (Apache-2.0), versioned in `runtime-assets/minimax-h3-turbo/` and synchronized to the local ComfyUI custom-node directory during startup, with its upstream license.

The LoRA weight is deliberately excluded from Git because it is a local runtime asset. It is not sent through the application proxy and is used only by the local ComfyUI process.
