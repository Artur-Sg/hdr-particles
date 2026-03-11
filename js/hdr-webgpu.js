(() => {
  const canvas = document.getElementById('gpu-canvas');
  const toggle = document.getElementById('ctrl-hdr-demo');
  const status = document.getElementById('hdr-status');
  const colorInput = document.getElementById('ctrl-color');
  const colorValue = document.querySelector('[data-for="ctrl-color"]');
  const intensityInput = document.getElementById('ctrl-hdr-intensity');
  const intensityValue = document.querySelector('[data-for="ctrl-hdr-intensity"]');
  const sizeInput = document.getElementById('ctrl-size');
  const sizeValue = document.querySelector('[data-for="ctrl-size"]');
  const countInput = document.getElementById('ctrl-count');
  const lifeInput = document.getElementById('ctrl-life');
  const speedInput = document.getElementById('ctrl-speed');
  const thresholdInput = document.getElementById('ctrl-threshold');
  const linksEnabledInput = document.getElementById('ctrl-links-enabled');
  const linksDistanceInput = document.getElementById('ctrl-links-distance');
  const linksCountInput = document.getElementById('ctrl-links-count');

  if (!canvas || !toggle || !status) return;

  let device = null;
  let context = null;
  let pipeline = null;
  let uniformBuffer = null;
  let bindGroup = null;
  let anim = null;
  let hdrActive = false;
  let currentFormat = null;
  let shaderModule = null;
  let lineShaderModule = null;
  let linePipeline = null;
  let pipelineLayout = null;
  let circleBuffer = null;
  let instanceBuffer = null;
  let lineBuffer = null;
  let lineBufferSize = 0;
  let lineVertexCount = 0;
  let msaaTexture = null;
  let msaaWidth = 0;
  let msaaHeight = 0;
  let circleVertexCount = 0;
  let positions = null;
  let velocities = null;
  let ages = null;
  let lifeT = null;
  let lifeBuffer = null;
  let particleCount = 1500;
  let maxLife = 300;
  let speed = 1;
  let speedFactor = 1;
  let linksEnabled = true;
  let linksDistancePx = 45;
  let linksPerParticle = 7;
  let linePositions = null;
  let maskReady = () => false;
  let maskSample = null;
  let maskPoints = [];
  let maskDirty = true;

  const setStatus = (text) => {
    status.textContent = text;
  };

  const setDemo = (enabled) => {
    document.body.dataset.hdrDemo = enabled ? 'on' : 'off';
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(2, Math.floor(rect.width * dpr));
    canvas.height = Math.max(2, Math.floor(rect.height * dpr));
    maskDirty = true;
    if (context && device) {
      configureContext();
    }
  };

  const configureContext = () => {
    if (!context || !device) return;
    const preferred = navigator.gpu.getPreferredCanvasFormat();
    const base = { device, alphaMode: 'opaque' };
    let formatUsed = preferred;

    try {
      context.configure({
        ...base,
        format: 'rgba16float',
        colorSpace: 'display-p3',
        toneMapping: { mode: 'extended' },
      });
      hdrActive = true;
      formatUsed = 'rgba16float';
      setStatus('rgba16float/p3/extended');
    } catch (err) {
      try {
        context.configure({
          ...base,
          format: preferred,
          colorSpace: 'display-p3',
        });
        hdrActive = false;
        formatUsed = preferred;
        setStatus('p3/sdr');
      } catch (err2) {
        context.configure({ ...base, format: preferred });
        hdrActive = false;
        formatUsed = preferred;
        setStatus('sdr');
      }
    }

    if (currentFormat !== formatUsed) {
      currentFormat = formatUsed;
      if (pipeline) {
        pipeline = createPipeline();
        bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });
      }
      if (linePipeline) {
        linePipeline = createLinePipeline();
      }
    }

    msaaTexture = null;
  };

  const createPipeline = () => {
    if (!device || !shaderModule) return null;
    return device.createRenderPipeline({
      layout: pipelineLayout || 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: 8,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
          },
          {
            arrayStride: 4,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: currentFormat || navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      multisample: { count: 4 },
    });
  };

  const createLinePipeline = () => {
    if (!device || !lineShaderModule) return null;
    return device.createRenderPipeline({
      layout: pipelineLayout || 'auto',
      vertex: {
        module: lineShaderModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 12,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module: lineShaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format: currentFormat || navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
      multisample: { count: 4 },
    });
  };

  const initParticles = () => {
    positions = new Float32Array(particleCount * 2);
    velocities = new Float32Array(particleCount * 2);
    ages = new Float32Array(particleCount);
    lifeT = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const idx = i * 2;
      const pos = spawnInMask();
      positions[idx] = pos[0];
      positions[idx + 1] = pos[1];
      velocities[idx] = (Math.random() * 2 - 1) * 0.0003 * speed;
      velocities[idx + 1] = (Math.random() * 2 - 1) * 0.0003 * speed;
      ages[i] = Math.random() * maxLife;
      lifeT[i] = ages[i] / maxLife;
    }
  };

  const init = async () => {
    if (!navigator.gpu) {
      setStatus('WebGPU недоступен');
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      setStatus('Нет GPU адаптера');
      return false;
    }
    device = await adapter.requestDevice();
    context = canvas.getContext('webgpu');
    if (!context) {
      setStatus('Нет WebGPU контекста');
      return false;
    }

    configureContext();

    shaderModule = device.createShaderModule({
      code: `
        struct Uniforms {
          color: vec3<f32>,
          intensity: f32,
          sizePx: f32,
          resX: f32,
          resY: f32,
          lineIntensity: f32,
        };
        @group(0) @binding(0) var<uniform> u: Uniforms;

        struct VSOut {
          @builtin(position) pos: vec4<f32>,
          @location(0) lifeT: f32,
        };

        @vertex
        fn vs(@location(0) unitPos: vec2<f32>, @location(1) instPos: vec2<f32>, @location(2) lifeT: f32) -> VSOut {
          var out: VSOut;
          let sizeNdc = vec2<f32>(u.sizePx / u.resX * 2.0, u.sizePx / u.resY * 2.0);
          let offset = unitPos * sizeNdc;
          out.pos = vec4<f32>(instPos.x + offset.x, -(instPos.y + offset.y), 0.0, 1.0);
          out.lifeT = lifeT;
          return out;
        }

        @fragment
        fn fs(@location(0) lifeT: f32) -> @location(0) vec4<f32> {
          let color = u.color * u.intensity;
          let fade = smoothstep(0.0, 0.2, lifeT) * smoothstep(1.0, 0.8, lifeT);
          return vec4<f32>(color, fade);
        }
      `,
    });

    pipeline = createPipeline();

    lineShaderModule = device.createShaderModule({
      code: `
        struct Uniforms {
          color: vec3<f32>,
          intensity: f32,
          sizePx: f32,
          resX: f32,
          resY: f32,
          lineIntensity: f32,
        };
        @group(0) @binding(0) var<uniform> u: Uniforms;

        struct VSOut {
          @builtin(position) pos: vec4<f32>,
          @location(0) alpha: f32,
        };

        @vertex
        fn vs(@location(0) pos: vec2<f32>, @location(1) alpha: f32) -> VSOut {
          var out: VSOut;
          out.pos = vec4<f32>(pos, 0.0, 1.0);
          out.alpha = alpha;
          return out;
        }

        @fragment
        fn fs(@location(0) alpha: f32) -> @location(0) vec4<f32> {
          let color = u.color * u.lineIntensity;
          return vec4<f32>(color, alpha);
        }
      `,
    });

    uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    pipeline = createPipeline();
    linePipeline = createLinePipeline();

    bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    initParticles();

    const segments = 48;
    const circleVerts = new Float32Array(segments * 3 * 2);
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const idx = i * 6;
      circleVerts[idx] = 0;
      circleVerts[idx + 1] = 0;
      circleVerts[idx + 2] = Math.cos(a0);
      circleVerts[idx + 3] = Math.sin(a0);
      circleVerts[idx + 4] = Math.cos(a1);
      circleVerts[idx + 5] = Math.sin(a1);
    }

    circleBuffer = device.createBuffer({
      size: circleVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(circleBuffer, 0, circleVerts);
    circleVertexCount = segments * 3;

    instanceBuffer = device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    lifeBuffer = device.createBuffer({
      size: lifeT.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    applyCount();
    applyLife();
    applySpeed();
    applyLinks();

    return true;
  };

  const hexToRgb = (hex) => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return [1, 1, 1];
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b];
  };

  const updateUniforms = () => {
    const color = colorInput ? hexToRgb(colorInput.value) : [1, 1, 1];
    const intensity = intensityInput ? parseFloat(intensityInput.value) : 1.2;
    const sizePx = sizeInput ? parseFloat(sizeInput.value) : 10;
    const lineIntensity = intensity * 0.6;
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([
        color[0],
        color[1],
        color[2],
        intensity,
        sizePx,
        canvas.width,
        canvas.height,
        lineIntensity,
      ])
    );
  };

  const updateParticles = () => {
    for (let i = 0; i < particleCount; i += 1) {
      const idx = i * 2;
      let x = positions[idx] + velocities[idx];
      let y = positions[idx + 1] + velocities[idx + 1];

      ages[i] += 1;
      if (ages[i] > maxLife) {
        const pos = spawnInMask();
        positions[idx] = pos[0];
        positions[idx + 1] = pos[1];
        velocities[idx] = (Math.random() * 2 - 1) * 0.0003 * speed;
        velocities[idx + 1] = (Math.random() * 2 - 1) * 0.0003 * speed;
        ages[i] = 0;
        lifeT[i] = 0;
        continue;
      }

      if (x < -1) x = 1;
      if (x > 1) x = -1;
      if (y < -1) y = 1;
      if (y > 1) y = -1;

      if (maskSample && (!maskReady || maskReady())) {
        const b = maskSample(x, y);
        const threshold = thresholdInput ? parseFloat(thresholdInput.value) : 1;
        if (b < threshold) {
          const pos = spawnInMask();
          positions[idx] = pos[0];
          positions[idx + 1] = pos[1];
          ages[i] = 0;
          lifeT[i] = 0;
          continue;
        }
      }

      positions[idx] = x;
      positions[idx + 1] = y;
      lifeT[i] = ages[i] / maxLife;
    }
  };

  const spawnInMask = () => {
    if (!maskSample || (maskReady && !maskReady())) {
      return [Math.random() * 2 - 1, Math.random() * 2 - 1];
    }
    if (maskDirty || maskPoints.length === 0) {
      buildMaskPoints();
    }
    if (maskPoints.length > 0) {
      const idx = Math.floor(Math.random() * (maskPoints.length / 2)) * 2;
      return [maskPoints[idx], maskPoints[idx + 1]];
    }
    return [Math.random() * 2 - 1, Math.random() * 2 - 1];
  };

  const buildLinks = () => {
    if (!linksEnabled || linksPerParticle <= 0) {
      lineVertexCount = 0;
      return;
    }

    const maxDist = linksDistancePx;
    const maxDistSq = maxDist * maxDist;
    const px = new Float32Array(particleCount);
    const py = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const idx = i * 2;
      px[i] = (positions[idx] * 0.5 + 0.5) * canvas.width;
      py[i] = ((-positions[idx + 1]) * 0.5 + 0.5) * canvas.height;
    }

    const cellSize = maxDist;
    const grid = new Map();
    const cellKey = (x, y) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

    for (let i = 0; i < particleCount; i += 1) {
      const key = cellKey(px[i], py[i]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    const lines = [];
    const best = [];
    for (let i = 0; i < particleCount; i += 1) {
      const cx = Math.floor(px[i] / cellSize);
      const cy = Math.floor(py[i] / cellSize);
      best.length = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const key = `${cx + ox}:${cy + oy}`;
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b += 1) {
            const j = bucket[b];
            if (i === j) continue;
            const dx = px[i] - px[j];
            const dy = py[i] - py[j];
            const d2 = dx * dx + dy * dy;
            if (d2 > maxDistSq) continue;

            if (best.length < linksPerParticle) {
              best.push({ j, d2 });
              continue;
            }

            let worstIndex = 0;
            let worstDist = best[0].d2;
            for (let k = 1; k < best.length; k += 1) {
              if (best[k].d2 > worstDist) {
                worstDist = best[k].d2;
                worstIndex = k;
              }
            }
            if (d2 < worstDist) {
              best[worstIndex] = { j, d2 };
            }
          }
        }
      }

      for (let k = 0; k < best.length; k += 1) {
        const j = best[k].j;
        if (i >= j) continue;
        const dist = Math.sqrt(best[k].d2);
        const alpha = Math.max(0, 1 - dist / maxDist) * 0.7 * Math.min(lifeT[i], lifeT[j]);
        if (alpha <= 0) continue;
        const idxI = i * 2;
        const idxJ = j * 2;
        lines.push(positions[idxI], -positions[idxI + 1], alpha);
        lines.push(positions[idxJ], -positions[idxJ + 1], alpha);
      }
    }

    linePositions = new Float32Array(lines);
    lineVertexCount = linePositions.length / 3;
  };

  const applyCount = () => {
    const base = countInput ? parseInt(countInput.value, 10) : 100;
    particleCount = Math.max(50, Math.floor(base * 6));
    initParticles();
    if (device) {
      instanceBuffer = device.createBuffer({
        size: positions.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      lifeBuffer = device.createBuffer({
        size: lifeT.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
  };

  const applyLife = () => {
    maxLife = lifeInput ? parseFloat(lifeInput.value) : 300;
  };

  const applySpeed = () => {
    const v = speedInput ? parseFloat(speedInput.value) : 1;
    const next = Math.max(0.01, v * v);
    const scale = next / speedFactor;
    speedFactor = next;
    speed = next;
    if (velocities) {
      for (let i = 0; i < velocities.length; i += 1) {
        velocities[i] *= scale;
      }
    }
  };

  const applyLinks = () => {
    linksEnabled = linksEnabledInput ? linksEnabledInput.checked : true;
    linksDistancePx = linksDistanceInput ? parseFloat(linksDistanceInput.value) : 45;
    linksPerParticle = linksCountInput ? parseInt(linksCountInput.value, 10) : 7;
  };

  const refreshMaskRefs = () => {
    if (window.hdrMaskSample) maskSample = window.hdrMaskSample;
    if (window.hdrMaskReady) maskReady = window.hdrMaskReady;
    maskDirty = true;
  };

  const waitForMask = () => {
    refreshMaskRefs();
    if (maskSample && (!maskReady || maskReady())) {
      applyCount();
      return;
    }
    setTimeout(waitForMask, 100);
  };

  const buildMaskPoints = () => {
    if (!maskSample || (maskReady && !maskReady())) {
      maskPoints = [];
      return;
    }
    const threshold = thresholdInput ? parseFloat(thresholdInput.value) : 1;
    const step = 6;
    const points = [];
    for (let y = 0; y < canvas.height; y += step) {
      const ny = (y / canvas.height) * 2 - 1;
      for (let x = 0; x < canvas.width; x += step) {
        const nx = (x / canvas.width) * 2 - 1;
        if (maskSample(nx, ny) >= threshold) {
          points.push(nx, ny);
        }
      }
    }
    maskPoints = points;
    maskDirty = false;
  };

  const frame = () => {
    if (!device || !context || !pipeline) return;

    updateParticles();
    buildLinks();
    updateUniforms();
    device.queue.writeBuffer(instanceBuffer, 0, positions);
    device.queue.writeBuffer(lifeBuffer, 0, lifeT);
    if (lineVertexCount > 0) {
      const needed = linePositions.byteLength;
      if (!lineBuffer || lineBufferSize < needed) {
        lineBuffer = device.createBuffer({
          size: needed,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        lineBufferSize = needed;
      }
      device.queue.writeBuffer(lineBuffer, 0, linePositions);
    }

    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();
    let colorView = view;
    let resolveTarget = undefined;

    if (true) {
      if (!msaaTexture || msaaWidth !== canvas.width || msaaHeight !== canvas.height) {
        msaaTexture = device.createTexture({
          size: [canvas.width, canvas.height],
          format: currentFormat || navigator.gpu.getPreferredCanvasFormat(),
          sampleCount: 4,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        msaaWidth = canvas.width;
        msaaHeight = canvas.height;
      }
      colorView = msaaTexture.createView();
      resolveTarget = view;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          resolveTarget,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, circleBuffer);
    pass.setVertexBuffer(1, instanceBuffer);
    pass.setVertexBuffer(2, lifeBuffer);
    pass.draw(circleVertexCount, particleCount);
    if (lineVertexCount > 0 && linePipeline) {
      pass.setPipeline(linePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, lineBuffer);
      pass.draw(lineVertexCount);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);

    anim = requestAnimationFrame(frame);
  };

  const start = async () => {
    if (!device) {
      const ok = await init();
      if (!ok) return;
    }
    refreshMaskRefs();
    waitForMask();
    resize();
    if (!anim) anim = requestAnimationFrame(frame);
  };

  const stop = () => {
    if (anim) {
      cancelAnimationFrame(anim);
      anim = null;
    }
  };

  toggle.addEventListener('change', async () => {
    setDemo(toggle.checked);
    if (toggle.checked) {
      await start();
    } else {
      stop();
    }
  });

  if (colorInput && colorValue) {
    colorValue.textContent = colorInput.value;
    colorInput.addEventListener('input', () => {
      colorValue.textContent = colorInput.value;
    });
  }

  if (intensityInput && intensityValue) {
    intensityValue.textContent = intensityInput.value;
    intensityInput.addEventListener('input', () => {
      intensityValue.textContent = intensityInput.value;
    });
  }

  if (sizeInput && sizeValue) {
    sizeValue.textContent = sizeInput.value;
    sizeInput.addEventListener('input', () => {
      sizeValue.textContent = sizeInput.value;
    });
  }

  if (countInput) {
    countInput.addEventListener('input', () => {
      applyCount();
    });
  }

  if (lifeInput) {
    lifeInput.addEventListener('input', () => {
      applyLife();
    });
  }

  if (speedInput) {
    speedInput.addEventListener('input', () => {
      applySpeed();
    });
  }

  if (linksEnabledInput) {
    linksEnabledInput.addEventListener('change', () => {
      applyLinks();
    });
  }
  if (linksDistanceInput) {
    linksDistanceInput.addEventListener('input', () => {
      applyLinks();
    });
  }
  if (linksCountInput) {
    linksCountInput.addEventListener('input', () => {
      applyLinks();
    });
  }

  if (thresholdInput) {
    thresholdInput.addEventListener('input', () => {
      maskDirty = true;
    });
  }

  window.addEventListener('resize', () => {
    resize();
  });

  window.hdrMaskUpdated = () => {
    refreshMaskRefs();
    if (maskSample && (!maskReady || maskReady())) {
      buildMaskPoints();
    }
    if (document.body.dataset.hdrDemo === 'on') {
      applyCount();
    }
  };

  setDemo(true);
  setStatus('init');
  if (toggle.checked) {
    start();
  }
})();
