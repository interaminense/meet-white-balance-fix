# Meet White Balance Fix

A Chrome extension (Manifest V3) that fixes webcam color in **Google Meet** with
real-time, software **RGB adjustment** (WebGL) and presets.

## Why

On Linux, Chrome resets the camera's white balance to the driver default
(auto white balance **on**) every time it starts the stream
(`V4L2CaptureDelegate::ResetUserAndCameraControlsToDefault` in
[`v4l2_capture_delegate.cc`](https://chromium.googlesource.com/chromium/src/media/+/refs/heads/main/capture/video/linux/v4l2_capture_delegate.cc)).
For cameras whose auto white balance handles warm office lighting poorly, the
result is a yellow-tinted image — and there is no Chrome flag to disable the reset.

This extension sidesteps the problem entirely: instead of relying on hardware
controls Chrome keeps overriding, it corrects the color **in software**, so the
adjustment is stable and applies to the transmitted stream (what other
participants see), not just your local self-view.

## How it works

| File | World | Role |
| --- | --- | --- |
| `engine.js` | MAIN | Wraps `getUserMedia`, runs a WebGL pipeline (per-channel R/G/B gain, temperature, brightness, contrast, saturation) and returns `canvas.captureStream()`. |
| `bridge.js` | ISOLATED | Relays parameters from `chrome.storage` to the engine via `window.postMessage` (the MAIN world has no `chrome.*` access). |
| `popup.html` / `popup.js` / `popup.css` | — | The UI: sliders, presets, on/off toggle. |

Data flow for live updates:

```
slider in popup → chrome.storage.local → onChanged → bridge → window.postMessage → engine updates shader uniforms → self-view changes live
```

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Reload your Google Meet tab (scripts inject at `document_start`)

## Usage

- Click the extension icon to open the popup.
- Start from the **Neutral 3100K** preset, then fine-tune with the sliders — the
  self-view updates live.
- **Save preset** stores your combination under "Custom".
- The **on** toggle disables the color adjustment (passthrough).

## Notes / limitations

- Processes camera video only (`getUserMedia`); does not affect screen sharing.
- Output resolution and frame rate follow the camera.
- Scoped to `meet.google.com` by default — add more hosts under `matches` in
  `manifest.json` to cover Zoom, Teams, etc.
