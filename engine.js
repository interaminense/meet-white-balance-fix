// Meet White Balance Fix — engine (MAIN world)
// -----------------------------------------------------------------------------
// Intercepts navigator.mediaDevices.getUserMedia and hands Meet back the video
// already color-corrected via WebGL. Because the processed stream is what Meet
// transmits, the adjustment also applies for other participants — not just the
// local self-view.
//
// This script runs in the MAIN world and has NO access to chrome.* APIs — it
// receives color parameters from bridge.js (ISOLATED world) via window.postMessage.
// -----------------------------------------------------------------------------
(() => {
  "use strict";
  const TAG = "[WB-fix engine]";

  // Current parameters (overwritten by the bridge). Identity = no change.
  let params = {
    enabled: true, temperature: 0, r: 1, g: 1, b: 1,
    brightness: 0, contrast: 0, saturation: 0,
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "wbfix" || d.type !== "params") return;
    params = Object.assign({}, params, d.params);
  });
  // Ask the bridge for the current params (in case it loaded first).
  window.postMessage({ source: "wbfix", type: "request" }, "*");

  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") return;
  const original = md.getUserMedia.bind(md);

  const VS = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() { v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const FS = `
    precision mediump float;
    uniform sampler2D u_tex;
    uniform vec3 u_gain;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    varying vec2 v_uv;
    void main() {
      vec3 c = texture2D(u_tex, v_uv).rgb;
      c *= u_gain;                              // per-channel gain (+ temperature)
      c += u_brightness;                        // brightness (additive)
      c = (c - 0.5) * u_contrast + 0.5;         // contrast
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luma), c, u_saturation);     // saturation
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`;

  // Builds the WebGL pipeline for a raw stream and resolves with the processed track.
  function buildProcessor(rawStream) {
    const videoTrack = rawStream.getVideoTracks()[0];
    const fps = (videoTrack.getSettings && videoTrack.getSettings().frameRate) || 30;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([videoTrack]);

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { alpha: false, premultipliedAlpha: false });
    if (!gl) {
      console.warn(TAG, "WebGL unavailable — returning raw stream");
      return null;
    }

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(TAG, "shader:", gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      // x, y, u, v
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    const aUv = gl.getAttribLocation(prog, "a_uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const uGain = gl.getUniformLocation(prog, "u_gain");
    const uBright = gl.getUniformLocation(prog, "u_brightness");
    const uContrast = gl.getUniformLocation(prog, "u_contrast");
    const uSat = gl.getUniformLocation(prog, "u_saturation");

    let running = true;
    const render = () => {
      if (!running) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = video.videoWidth, h = video.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
        }
        const on = params.enabled;
        const t = on ? params.temperature : 0;
        // Temperature pushes R up and B down (warm), or the reverse (cool).
        gl.uniform3f(uGain,
          (on ? params.r : 1) * (1 + t * 0.004),
          (on ? params.g : 1),
          (on ? params.b : 1) * (1 - t * 0.004));
        gl.uniform1f(uBright, on ? params.brightness / 200 : 0);
        gl.uniform1f(uContrast, on ? 1 + params.contrast / 100 : 1);
        gl.uniform1f(uSat, on ? 1 + params.saturation / 100 : 1);

        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(render);
      else requestAnimationFrame(render);
    };

    return new Promise((resolve) => {
      const start = () => {
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        gl.viewport(0, 0, canvas.width, canvas.height);
        render();
        const out = canvas.captureStream(fps);
        const procTrack = out.getVideoTracks()[0];
        // When the processed track stops (Meet ending), release the real camera.
        const origStop = procTrack.stop.bind(procTrack);
        procTrack.stop = () => {
          running = false;
          origStop();
          try { videoTrack.stop(); } catch (e) {}
        };
        videoTrack.addEventListener("ended", () => { running = false; });
        resolve(procTrack);
      };
      video.addEventListener("loadedmetadata", start, { once: true });
      video.play().catch(() => {});
    });
  }

  md.getUserMedia = async function (constraints) {
    const stream = await original(constraints);
    try {
      if (stream.getVideoTracks().length === 0) return stream; // audio only
      const procTrack = await buildProcessor(stream);
      if (!procTrack) return stream;
      const out = new MediaStream([procTrack, ...stream.getAudioTracks()]);
      console.log(TAG, "processed stream active");
      return out;
    } catch (err) {
      console.warn(TAG, "processing failed — returning raw:", err);
      return stream;
    }
  };

  console.log(TAG, "active");
})();
