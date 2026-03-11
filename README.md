# HDR Particles (WebGPU + p5.js)

This repo is a small playground to test **real HDR (High Dynamic Range) output** in the browser and compare it with a classic 2D canvas workflow.

I initially used **p5.js** (2D canvas) to draw particles, but HDR does **not** work there because the HTML 2D canvas is **SDR (Standard Dynamic Range)** only.  
The project then moved to **WebGPU**, where HDR can work on supported hardware/browsers.

## What this does

- **HDR mode (WebGPU):** renders neon HDR particles on a full-screen WebGPU canvas.
- **SDR mode (p5.js):** the same particle system runs in p5.js for comparison.
- **Text / Image masks:** particles spawn only inside bright areas of the text or the uploaded image.
- **Links:** optional connections between nearby particles.

## Why this is interesting

HDR (High Dynamic Range) means pixels can be brighter than “white” and have a wider color gamut.  
This is visible only if the **display**, **OS**, and **browser** all support HDR.

## When HDR works

HDR output works only when:

- The display supports HDR and HDR is enabled in the OS.
- The browser supports WebGPU HDR (Chrome and Safari on supported hardware).
- Power saving mode is **off** (often disables HDR).

## How HDR is enabled here

The WebGPU canvas is configured with:

- `format: "rgba16float"`
- `colorSpace: "display-p3"`
- `toneMapping: { mode: "extended" }`

This is the minimum to get real HDR output (when supported).

## Experimental 2D Canvas HDR (Proposal)

The HTML 2D canvas is SDR by design. An **experimental** HDR path is proposed in the
ColorWeb Community Group draft (not a stable standard):

https://github.com/w3c/ColorWeb-CG/blob/main/hdr_html_canvas_element.md

Example (experimental only):

```js
canvas.getContext('2d', {
  colorSpace: 'rec2100-hlg', // or 'rec2100-pq'
  pixelFormat: 'float16'
});
```

This is **not a stable web standard** and may only work in experimental builds/flags.  
If it fails, it falls back to standard SDR 2D canvas.

## App features

- **HDR toggle** (WebGPU on/off)
- **Color** (global) and **Intensity** (HDR only)
- **Text / Image source** for particle mask
- **Particle size, count, lifetime, speed**
- **Brightness threshold** for mask
- **Links** with distance and per-particle limits

## Quick start

Open `index.html` in a local server (recommended). HDR is enabled by default, and you can toggle it in the UI.

If HDR is supported, you will see a status like:

`rgba16float/p3/extended`

If it falls back, you’ll see:

`p3/sdr` or `sdr` (Standard Dynamic Range)

## Notes

- The HTML 2D canvas is SDR by design, so p5.js is SDR as well.
- The HDR mode is full-screen WebGPU and is the only way to see true HDR in this project.
