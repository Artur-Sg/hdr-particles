let loadedImg = null;
let imgReady = false;
let imgPixels = null;
let imgW = 0;
let imgH = 0;
let imgFit = null;
const particles = [];
let nextParticleId = 1;
let sourceMode = 'text';
const params = {
    spawnCount: 250,
    life: 300,
    threshold: 1,
    speed: 1,
    size: 5,
    color: { r: 31, g: 255, b: 248 },
    linksDistance: 45,
    linksCount: 7,
    linksLife: 30,
    linksWidth: 1,
};

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('app');
    setupFileUI();
    const initialText = document.getElementById('ctrl-text');
    generateFromText(initialText ? initialText.value : 'HELLO WORLD');
    window.hdrMaskSample = (nx, ny) => {
        const x = (nx * 0.5 + 0.5) * width;
        const y = (ny * 0.5 + 0.5) * height;
        return brightnessAtCanvas(x, y);
    };
    window.hdrMaskReady = () => imgReady;
}

function draw() {
    if (document.body.dataset.renderer === 'webgpu') {
        return;
    }
    background(11, 12, 16);

    updateParticles();

    if (imgReady) {
        return;
    }
}

function setupFileUI() {
    const openBtn = document.getElementById('open-image');
    const fileInput = document.getElementById('file-input');
    const textInput = document.getElementById('ctrl-text');
    const srcImage = document.getElementById('src-image');
    const srcText = document.getElementById('src-text');
    const ui = document.querySelector('.ui');
    const colorInput = document.getElementById('ctrl-color');
    const colorValue = document.querySelector('[data-for="ctrl-color"]');
    const controls = [
        { id: 'ctrl-count', key: 'spawnCount' },
        { id: 'ctrl-life', key: 'life' },
        { id: 'ctrl-threshold', key: 'threshold' },
        { id: 'ctrl-speed', key: 'speed' },
        { id: 'ctrl-size', key: 'size' },
        { id: 'ctrl-links-distance', key: 'linksDistance' },
        { id: 'ctrl-links-count', key: 'linksCount' },
        { id: 'ctrl-links-width', key: 'linksWidth' },
    ];
    const toggles = [];

    const setMode = (mode) => {
        sourceMode = mode;
        if (ui) ui.dataset.mode = mode;
        document.body.dataset.mode = mode;
        if (mode === 'image' && !loadedImg) {
            imgReady = false;
        }
    };

    setMode(sourceMode);

    openBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            setMode('image');
            srcImage.checked = true;
            loadedImg = loadImage(reader.result, onImageLoaded);
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
    });

    srcImage.addEventListener('change', () => {
        if (srcImage.checked) {
            setMode('image');
        }
    });
    srcText.addEventListener('change', () => {
        if (srcText.checked) {
            setMode('text');
            generateFromText(textInput.value);
        }
    });

    let textDebounce = null;
    textInput.addEventListener('input', () => {
        if (sourceMode !== 'text') return;
        if (textDebounce) clearTimeout(textDebounce);
        textDebounce = setTimeout(() => {
            generateFromText(textInput.value);
            textDebounce = null;
        }, 160);
    });

    controls.forEach(({ id, key }) => {
        const input = document.getElementById(id);
        const value = document.querySelector(`[data-for="${id}"]`);
        if (!input || !value) return;
        const apply = () => {
            const v = parseFloat(input.value);
            params[key] = v;
            value.textContent = input.value;
        };
        input.addEventListener('input', apply);
        apply();
    });

    if (colorInput && colorValue) {
        const applyColor = () => {
            colorValue.textContent = colorInput.value;
            const hex = colorInput.value.replace('#', '');
            if (hex.length === 6) {
                params.color = {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16),
                };
            }
        };
        colorInput.addEventListener('input', applyColor);
        applyColor();
    }

    toggles.forEach(({ id, key }) => {
        const input = document.getElementById(id);
        if (!input) return;
        const apply = () => {
            params[key] = input.checked;
        };
        input.addEventListener('change', apply);
        apply();
    });

}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (loadedImg && imgReady) {
        imgFit = computeImageFit();
    }
    if (sourceMode === 'text' && imgReady) {
        const textInput = document.getElementById('ctrl-text');
        generateFromText(textInput ? textInput.value : '');
    }
}

function updateParticles() {
    if (window.hdrMaskEmpty) {
        particles.length = 0;
        return;
    }
    if (imgReady) {
        spawnFromBrightness(params.spawnCount);
    }

    updateConnections();

    for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.update();
        p.render();
        if (p.isDead()) {
            particles.splice(i, 1);
        }
    }

    renderConnections();
}

function onImageLoaded() {
    imgReady = false;
    loadedImg.loadPixels();
    imgPixels = loadedImg.pixels;
    imgW = loadedImg.width;
    imgH = loadedImg.height;
    imgFit = computeImageFit();
    imgReady = true;
    particles.length = 0;
    if (window.hdrMaskUpdated) window.hdrMaskUpdated();
}

function generateFromText(text) {
    imgReady = false;
    const trimmed = text ? text.trim() : '';
    if (!trimmed) {
        imgPixels = null;
        imgW = 0;
        imgH = 0;
        imgFit = null;
        particles.length = 0;
        window.hdrMaskEmpty = true;
        if (window.hdrMaskUpdated) window.hdrMaskUpdated();
        return;
    }
    window.hdrMaskEmpty = false;
    const gfx = createGraphics(width, height);
    gfx.pixelDensity(1);
    gfx.clear();
    gfx.fill(255);
    gfx.noStroke();
    gfx.textAlign(CENTER, CENTER);

    const content = trimmed;
    const targetW = width * 0.75;
    const targetH = height * 0.75;
    let fontSize = min(width, height) * 0.35;
    let lines = [];

    const wrapLines = (value, maxW) => {
        const rawLines = value.split('\n');
        const out = [];
        for (let i = 0; i < rawLines.length; i += 1) {
            const words = rawLines[i].split(/\s+/).filter(Boolean);
            if (words.length === 0) {
                out.push(' ');
                continue;
            }
            let line = words[0];
            for (let w = 1; w < words.length; w += 1) {
                const test = `${line} ${words[w]}`;
                if (gfx.textWidth(test) <= maxW) {
                    line = test;
                } else {
                    out.push(line);
                    line = words[w];
                }
            }
            out.push(line);
        }
        return out;
    };

    for (let i = 0; i < 30; i += 1) {
        gfx.textSize(fontSize);
        lines = wrapLines(content, targetW);
        const lineHeight = fontSize * 1.2;
        const totalH = lines.length * lineHeight;
        const widest = lines.reduce((m, l) => max(m, gfx.textWidth(l)), 0);
        if (widest <= targetW && totalH <= targetH) break;
        fontSize *= 0.92;
    }

    gfx.textSize(fontSize);
    const lineHeight = fontSize * 1.2;
    const startY = height * 0.5 - (lines.length - 1) * lineHeight * 0.5;
    for (let i = 0; i < lines.length; i += 1) {
        gfx.text(lines[i], width * 0.5, startY + i * lineHeight);
    }
    gfx.loadPixels();
    imgPixels = gfx.pixels;
    imgW = gfx.width;
    imgH = gfx.height;
    imgFit = { x: 0, y: 0, w: width, h: height, scale: 1 };
    imgReady = true;
    particles.length = 0;
    if (window.hdrMaskUpdated) window.hdrMaskUpdated();
}

function computeImageFit() {
    const scale = min(width / imgW, height / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return {
        x: (width - w) * 0.5,
        y: (height - h) * 0.5,
        w,
        h,
        scale,
    };
}

function canvasToImage(x, y) {
    if (!imgFit) return null;
    const ix = (x - imgFit.x) / imgFit.scale;
    const iy = (y - imgFit.y) / imgFit.scale;
    if (ix < 0 || iy < 0 || ix >= imgW || iy >= imgH) return null;
    return { x: ix, y: iy };
}

function brightnessAtCanvas(x, y) {
    if (window.hdrMaskEmpty) return 0;
    if (!imgPixels) return 0;
    const p = canvasToImage(x, y);
    if (!p) return 0;
    const ix = floor(p.x);
    const iy = floor(p.y);
    const idx = (iy * imgW + ix) * 4;
    const r = imgPixels[idx];
    const g = imgPixels[idx + 1];
    const b = imgPixels[idx + 2];
    return (r + g + b) / 3;
}

function spawnFromBrightness(count) {
    if (!imgFit) return;
    for (let i = 0; i < count; i += 1) {
        const x = random(imgFit.x, imgFit.x + imgFit.w);
        const y = random(imgFit.y, imgFit.y + imgFit.h);
        const b = brightnessAtCanvas(x, y);
        if (b > params.threshold && random(255) < b) {
            particles.push(new Particle(createVector(x, y), b));
        }
    }
}


class Particle {
    constructor(position, sourceBrightness = 200) {
        this.id = nextParticleId;
        nextParticleId += 1;
        this.pos = position.copy();
        this.dir = p5.Vector.random2D().mult(random(0.3, params.speed));
        this.life = random(params.life * 0.6, params.life * 1.2);
        this.age = 0;
        this.brightness = constrain(sourceBrightness + random(-10, 20), 40, 255);
        const baseSize = map(this.brightness, 0, 255, 1.5, 6.5);
        this.size = baseSize * (params.size / 10);
        this.links = new Map();
    }

    update() {
        const next = p5.Vector.add(this.pos, this.dir);
        const b = brightnessAtCanvas(next.x, next.y);
        if (b < params.threshold) {
            this.age = this.life;
            return;
        }
        this.pos.set(next);
        this.age += 1;
    }

    render() {
        const alpha = map(this.age, 0, this.life, 220, 0) * (this.brightness / 255);
        noStroke();
        fill(params.color.r, params.color.g, params.color.b, alpha);
        circle(this.pos.x, this.pos.y, this.size);
    }

    isDead() {
        return this.age >= this.life;
    }
}

function updateConnections() {
    if (params.linksWidth <= 0 || params.linksCount <= 0) {
        return;
    }
    const maxDist = params.linksDistance;
    const maxDistSq = maxDist * maxDist;
    const maxLinks = params.linksCount;
    if (maxLinks <= 0) {
        return;
    }

    const cellSize = maxDist;
    const grid = new Map();
    const toCell = (x, y) => `${floor(x / cellSize)}:${floor(y / cellSize)}`;

    for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        const key = toCell(p.pos.x, p.pos.y);
        const bucket = grid.get(key);
        if (bucket) {
            bucket.push(p);
        } else {
            grid.set(key, [p]);
        }
    }

    const best = [];
    for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        const cx = floor(p.pos.x / cellSize);
        const cy = floor(p.pos.y / cellSize);
        best.length = 0;

        for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
                const key = `${cx + ox}:${cy + oy}`;
                const bucket = grid.get(key);
                if (!bucket) continue;
                for (let b = 0; b < bucket.length; b += 1) {
                    const q = bucket[b];
                    if (p === q) continue;
                    const dx = p.pos.x - q.pos.x;
                    const dy = p.pos.y - q.pos.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > maxDistSq) continue;

                    if (best.length < maxLinks) {
                        best.push({ id: q.id, distSq: d2 });
                        continue;
                    }

                    let worstIndex = 0;
                    let worstDist = best[0].distSq;
                    for (let k = 1; k < best.length; k += 1) {
                        if (best[k].distSq > worstDist) {
                            worstDist = best[k].distSq;
                            worstIndex = k;
                        }
                    }
                    if (d2 < worstDist) {
                        best[worstIndex] = { id: q.id, distSq: d2 };
                    }
                }
            }
        }

        const used = new Set();
        for (let k = 0; k < best.length; k += 1) {
            const c = best[k];
            used.add(c.id);
            p.links.set(c.id, params.linksLife);
        }
        for (const [id, life] of p.links) {
            if (used.has(id)) continue;
            const nextLife = life - 1;
            if (nextLife <= 0) {
                p.links.delete(id);
            } else {
                p.links.set(id, nextLife);
            }
        }
    }
}

function renderConnections() {
    if (params.linksWidth <= 0 || params.linksCount <= 0) {
        return;
    }
    const byId = new Map();
    for (let i = 0; i < particles.length; i += 1) {
        byId.set(particles[i].id, particles[i]);
    }

    strokeWeight(params.linksWidth);
    for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        for (const [id, life] of p.links) {
            if (p.id > id) continue;
            const q = byId.get(id);
            if (!q) continue;
            const alpha = map(life, 0, params.linksLife, 0, 140);
            stroke(params.color.r, params.color.g, params.color.b, alpha);
            line(p.pos.x, p.pos.y, q.pos.x, q.pos.y);
        }
    }
}
