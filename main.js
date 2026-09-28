import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* =========================================================================
   Utilities
   ========================================================================= */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (p, a, b) => clamp((p - a) / (b - a));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eramp = (p, a, b) => ease(ramp(p, a, b));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);

const pctEl = document.getElementById('load-pct');
const setPct = (v) => { pctEl.textContent = `${Math.round(v)}%`; };

await Promise.race([
  Promise.all([
    document.fonts.load('500 80px "Cormorant Garamond"'),
    document.fonts.load('500 20px "Montserrat"'),
  ]),
  new Promise((r) => setTimeout(r, 2500)),
]);

/* =========================================================================
   Renderer / post-processing
   ========================================================================= */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(window.devicePixelRatio, 1.75);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.03, 250);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
// guard: a stray NaN/Inf pixel would otherwise be smeared across the frame by bloom
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv);
      if(any(isnan(c)) || any(isinf(c))) c=vec4(0.,0.,0.,1.);
      gl_FragColor=min(c, vec4(40.)); }`,
}));
const bokeh = new BokehPass(scene, camera, { focus: 4, aperture: 0.004, maxblur: 0.006 });
bokeh.enabled = false;
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// The page starts as a pure white sheet. Because the frame is tone mapped,
// we feed the background the (inverse tone-mapped) value that displays as the target colour.
function acesGray(x) {
  const v = (x * renderer.toneMappingExposure) / 0.6;
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return clamp(a / b);
}
function invAces(y) {
  if (y >= 0.999) return 26;
  let lo = 0, hi = 26;
  for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (acesGray(m) < y) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const WHITE = new THREE.Color('#ffffff');
const DUSK = new THREE.Color('#0a1222');
const bgDisplay = new THREE.Color();
const bgLinear = new THREE.Color();
function setBackground(s) {
  bgDisplay.copy(WHITE).lerp(DUSK, s); // linear working-space colour we want to *see*
  bgLinear.setRGB(invAces(bgDisplay.r), invAces(bgDisplay.g), invAces(bgDisplay.b));
  scene.background.copy(bgLinear);
  scene.fog.color.copy(bgLinear);
}
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0xffffff, 45, 120);

/* =========================================================================
   Asset loading
   ========================================================================= */
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => setPct((loaded / total) * 100);
// The salesperson is a filmed (generated) namaste clip, pre-split into frames so it can be scrubbed by scroll.
const frameInfo = await fetch('assets/associate/frames.json').then((r) => r.json());
const imgLoader = new THREE.ImageLoader(manager);
const texLoader = new THREE.TextureLoader(manager);
const [hdr, frontSketch, frontClosed, frontOpen, backWallTex, ...assocFrames] = await Promise.all([
  new RGBELoader(manager).loadAsync('assets/studio.hdr'),
  texLoader.loadAsync('assets/front/sketch.jpg'),
  texLoader.loadAsync('assets/front/closed.jpg'),
  texLoader.loadAsync('assets/front/open.jpg'),
  texLoader.loadAsync('assets/interior/backwall.jpg'),
  ...Array.from({ length: frameInfo.count }, (_, i) =>
    imgLoader.loadAsync(`assets/associate/f_${String(i + 1).padStart(3, '0')}.jpg`)),
]);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromEquirectangular(hdr).texture;
hdr.dispose();
scene.environment = envTex;
scene.environmentIntensity = 0;

/* =========================================================================
   Storefront overlay: generated photograph of the boutique (closed / open doors)
   and its matching ink sketch, composited in one full-screen shader.
   ========================================================================= */
for (const t of [frontSketch, frontClosed, frontOpen]) {
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = THREE.LinearMipmapLinearFilter;
}
const ovScene = new THREE.Scene();
const ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const ovMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: {
    tSketch: { value: frontSketch }, tClosed: { value: frontClosed }, tOpen: { value: frontOpen },
    uScale: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: new THREE.Vector2(0.5, 0.37) }, // the doorway, in image UVs
    uParallax: { value: new THREE.Vector2() },
    uZoom: { value: 1 }, uDraw: { value: 0 }, uPhoto: { value: 0 }, uOpen: { value: 0 },
    uFlash: { value: 0 }, uAlpha: { value: 1 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `
    uniform sampler2D tSketch, tClosed, tOpen;
    uniform vec2 uScale, uFocus, uParallax;
    uniform float uZoom, uDraw, uPhoto, uOpen, uFlash, uAlpha, uTime;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.03; a *= .5; } return v; }
    void main(){
      vec2 uv = (vUv - 0.5) * uScale + 0.5;                 // cover-fit the 16:9 plates
      uv = uFocus + (uv - uFocus) / uZoom + uParallax / uZoom;
      uv = clamp(uv, 0.001, 0.999);

      // 1. the pen: ink appears from the ground up, in uneven patches like real strokes
      float order = uv.y * 0.6 + fbm(uv * vec2(9., 5.)) * 0.4;
      float drawn = smoothstep(order - 0.035, order, uDraw * 1.08 - 0.03);
      float ink = texture2D(tSketch, uv).r;
      vec3 sketch = mix(vec3(1.), vec3(ink), drawn);
      sketch = mix(sketch, vec3(1.), smoothstep(0.3, 0.0, vUv.y) * 0.7);   // keep the page clean under the headline

      // 2. the photograph, doors swinging open
      vec3 photo = mix(texture2D(tClosed, uv).rgb, texture2D(tOpen, uv).rgb, uOpen);
      photo *= mix(1.0, ink, 0.4 * (1. - uPhoto));             // pen lines linger as colour washes in

      // colour spreads outward from the doorway like ink bleeding through paper
      float d = distance(uv * vec2(1.79, 1.), uFocus * vec2(1.79, 1.));
      float field = d * 0.55 + fbm(uv * 4.5 + 3.1) * 0.5;
      float k = 1. - smoothstep(uPhoto * 1.35 - 0.14, uPhoto * 1.35, field);
      vec3 col = mix(sketch, photo, k);

      // 3. crossing the threshold: warm bloom of light
      float r = distance(vUv, vec2(0.5));
      col += vec3(1.0, 0.86, 0.62) * uFlash * (1.2 - r);
      gl_FragColor = vec4(col, uAlpha);
    }`,
});
ovScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ovMat));

const world = new THREE.Group();
scene.add(world);

/* =========================================================================
   Procedural textures (colour + bump), all tileable
   ========================================================================= */
const TEX_ANISO = renderer.capabilities.getMaxAnisotropy();
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, { srgb = true, tile = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = TEX_ANISO;
  if (tile) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function tileNoise(cells) {
  const s = makeCanvas(cells, cells), x = s.getContext('2d');
  const id = x.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) { const v = Math.random() * 255; id.data.set([v, v, v, 255], i * 4); }
  x.putImageData(id, 0, 0);
  const t = makeCanvas(cells * 3, cells * 3), tx = t.getContext('2d');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tx.drawImage(s, i * cells, j * cells);
  return t;
}
function fbm(g, w, h, { oct = 5, base = 4, alpha = 0.35, comp = 'overlay', falloff = 0.72 } = {}) {
  g.save();
  g.globalCompositeOperation = comp;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  for (let o = 0; o < oct; o++) {
    const c = base * 2 ** o;
    g.globalAlpha = alpha * Math.pow(falloff, o);
    g.drawImage(tileNoise(c), c, c, c, c, 0, 0, w, h);
  }
  g.restore();
}
function pair(w, h, drawColor, drawBump) {
  const c = makeCanvas(w, h), b = makeCanvas(w, h);
  drawColor(c.getContext('2d'), w, h);
  drawBump(b.getContext('2d'), w, h);
  return { map: toTex(c), bump: toTex(b, { srgb: false }) };
}

// ashlar stone blocks (texture = 2 m square)
const stoneT = pair(512, 512, (g, w, h) => {
  g.fillStyle = '#dccdb2'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) {
    const off = r % 2 ? 128 : 0;
    g.fillStyle = `hsla(38,${rand(18, 30)}%,${rand(70, 80)}%,0.5)`;
    g.fillRect(k * 256 + off, r * 128, 256, 128);
  }
  fbm(g, w, h, { alpha: 0.28 });
  g.fillStyle = 'rgba(90,75,55,0.55)';
  for (let r = 0; r < 4; r++) {
    g.fillRect(0, r * 128, w, 3);
    const off = r % 2 ? 128 : 0;
    for (let k = 0; k < 3; k++) g.fillRect(k * 256 + off, r * 128, 3, 128);
  }
}, (g, w, h) => {
  g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, w, h);
  fbm(g, w, h, { alpha: 0.5, base: 8 });
  g.fillStyle = '#202020';
  for (let r = 0; r < 4; r++) {
    g.fillRect(0, r * 128, w, 4);
    const off = r % 2 ? 128 : 0;
    for (let k = 0; k < 3; k++) g.fillRect(k * 256 + off, r * 128, 4, 128);
  }
});

// running-bond brick (texture = 1.2 m square)
const brickT = (() => {
  const W = 512, bw = 92, bh = 28, m = 5;
  const layout = [];
  for (let r = 0; r * (bh + m) < W; r++) for (let k = -1; k * (bw + m) < W + bw; k++)
    layout.push({ x: k * (bw + m) + (r % 2 ? (bw + m) / 2 : 0), y: r * (bh + m), l: rand(-8, 8), hh: rand(-6, 6) });
  return pair(W, W, (g) => {
    g.fillStyle = '#8f8577'; g.fillRect(0, 0, W, W);
    for (const b of layout) { g.fillStyle = `hsl(${14 + b.hh},${38 + b.l}%,${30 + b.l * 0.8}%)`; g.fillRect(b.x, b.y, bw, bh); }
    fbm(g, W, W, { alpha: 0.35, base: 16 });
  }, (g) => {
    g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, W, W);
    for (const b of layout) { g.fillStyle = `rgb(${190 + b.l * 3},${190 + b.l * 3},${190 + b.l * 3})`; g.fillRect(b.x, b.y, bw, bh); }
    fbm(g, W, W, { alpha: 0.45, base: 32 });
  });
})();

// walnut grain (texture = 1 m square)
const woodT = (() => {
  const lines = Array.from({ length: 260 }, () => ({
    y: Math.random() * 512, a: rand(2, 9), k: 1 + ((Math.random() * 3) | 0), ph: Math.random() * 6.28,
    wdt: rand(0.6, 2.6), dark: Math.random() < 0.6, al: rand(0.08, 0.3),
  }));
  const draw = (g, w, h, bump) => {
    g.fillStyle = bump ? '#808080' : '#4a2a18'; g.fillRect(0, 0, w, h);
    for (const L of lines) {
      g.strokeStyle = bump ? (L.dark ? `rgba(0,0,0,${L.al})` : `rgba(255,255,255,${L.al})`)
        : (L.dark ? `rgba(28,14,6,${L.al + 0.1})` : `rgba(130,82,48,${L.al})`);
      g.lineWidth = L.wdt;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = L.y + Math.sin((x / w) * Math.PI * 2 * L.k + L.ph) * L.a;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    if (!bump) fbm(g, w, h, { alpha: 0.18, base: 4 });
  };
  return pair(512, 512, (g, w, h) => draw(g, w, h, false), (g, w, h) => draw(g, w, h, true));
})();

// marble with veins (texture = 1.5 m square)
function marbleCanvas(g, w, h, base = '#eee8dd', vein = 'rgba(110,100,88,0.28)') {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  fbm(g, w, h, { alpha: 0.12, base: 4, comp: 'multiply' });
  g.filter = 'blur(0.8px)';
  for (let v = 0; v < 14; v++) {
    g.strokeStyle = vein; g.lineWidth = rand(0.6, 3.2);
    let x = Math.random() * w, y = Math.random() * h;
    const dx = rand(-1, 1), dy = rand(-1, 1);
    g.beginPath(); g.moveTo(x, y);
    for (let q = 0; q < 40; q++) { x += dx * 14 + rand(-9, 9); y += dy * 14 + rand(-9, 9); g.lineTo(x, y); }
    g.stroke();
  }
  g.filter = 'none';
}
const marbleTex = (() => { const c = makeCanvas(512, 512); marbleCanvas(c.getContext('2d'), 512, 512); return toTex(c); })();

// checker marble floor (texture = 4 m: 4 × 1 m tiles)
const floorTex = (() => {
  const c = makeCanvas(1024, 1024), g = c.getContext('2d'), s = 256;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const t = makeCanvas(s, s);
    marbleCanvas(t.getContext('2d'), s, s, (i + j) % 2 ? '#e9e2d4' : '#16211f', (i + j) % 2 ? 'rgba(120,110,95,0.25)' : 'rgba(200,190,170,0.16)');
    g.drawImage(t, i * s, j * s);
  }
  g.fillStyle = 'rgba(160,130,70,0.6)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * s - 1, 0, 2, 1024); g.fillRect(0, i * s - 1, 1024, 2); }
  return toTex(c);
})();

// sidewalk slabs (texture = 2.4 m)
const paveT = pair(512, 512, (g, w, h) => {
  g.fillStyle = '#77726b'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = `hsla(30,6%,${rand(40, 52)}%,0.6)`; g.fillRect(i * 128, j * 128, 128, 128); }
  fbm(g, w, h, { alpha: 0.4, base: 8 });
  g.fillStyle = '#3f3b37';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 1.5, 0, 3, h); g.fillRect(0, i * 128 - 1.5, w, 3); }
}, (g, w, h) => {
  g.fillStyle = '#aaa'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.6, base: 16 });
  g.fillStyle = '#111';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 2, 0, 4, h); g.fillRect(0, i * 128 - 2, w, 4); }
});

const asphaltT = pair(512, 512, (g, w, h) => {
  g.fillStyle = '#1b1d21'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.4, base: 32 });
}, (g, w, h) => { g.fillStyle = '#888'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.9, base: 64 }); });

const plasterT = pair(512, 512, (g, w, h) => {
  g.fillStyle = '#1f4943'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.16, base: 4 });
}, (g, w, h) => { g.fillStyle = '#888'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.5, base: 16 }); });

const leatherBump = (() => { const c = makeCanvas(256, 256), g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 256, 256); fbm(g, 256, 256, { alpha: 1, base: 32, oct: 3 }); return toTex(c, { srgb: false }); })();
const foliageBump = (() => { const c = makeCanvas(256, 256), g = c.getContext('2d'); g.fillStyle = '#777'; g.fillRect(0, 0, 256, 256); fbm(g, 256, 256, { alpha: 1, base: 24, oct: 3 }); return toTex(c, { srgb: false }); })();

function textTex(w, h, bg, draw) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  draw(g, w, h);
  return toTex(c, { tile: false });
}
const signTex = textTex(2048, 352, '#0e2c26', (g, w, h) => {
  fbm(g, w, h, { alpha: 0.12, base: 8 });
  g.strokeStyle = '#c9a24a'; g.lineWidth = 8; g.strokeRect(26, 26, w - 52, h - 52);
  g.lineWidth = 2; g.strokeRect(50, 50, w - 100, h - 100);
  const gr = g.createLinearGradient(0, 70, 0, 250);
  gr.addColorStop(0, '#f6dc97'); gr.addColorStop(0.5, '#caa04c'); gr.addColorStop(1, '#8e6a28');
  g.fillStyle = gr; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '300 150px Sora, sans-serif'; g.letterSpacing = '56px';
  g.fillText('AURELIA', w / 2 + 28, h * 0.44);
  g.font = '500 34px Montserrat, sans-serif'; g.letterSpacing = '16px'; g.fillStyle = '#d9b868';
  g.fillText('FINE GEMSTONES  ·  EST. 1962', w / 2 + 8, h * 0.77);
});
const brandTex = textTex(1024, 200, null, (g, w, h) => {
  g.fillStyle = '#e2bd6a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '200 96px Sora, sans-serif'; g.letterSpacing = '40px';
  g.fillText('AURELIA', w / 2 + 20, h * 0.45);
  g.fillRect(w / 2 - 60, h * 0.86, 120, 2);
});
const awningTex = textTex(512, 128, null, (g, w, h) => {
  const n = 14;
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#ece1c9' : '#143c33'; g.fillRect((i * w) / n, 0, w / n + 1, h); }
  fbm(g, w, h, { alpha: 0.2, base: 16 });
});
const rugTex = textTex(512, 360, '#5a121d', (g, w, h) => {
  fbm(g, w, h, { alpha: 0.25, base: 32 });
  g.strokeStyle = '#c29a48'; g.lineWidth = 10; g.strokeRect(20, 20, w - 40, h - 40);
  g.lineWidth = 2; g.strokeRect(40, 40, w - 80, h - 80);
  g.fillStyle = 'rgba(201,162,74,0.22)';
  for (let x = 80; x < w - 60; x += 44) for (let y = 80; y < h - 60; y += 44) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore();
  }
  g.strokeStyle = 'rgba(201,162,74,0.7)'; g.lineWidth = 3;
  g.beginPath(); g.ellipse(w / 2, h / 2, 90, 60, 0, 0, Math.PI * 2); g.stroke();
});
const windowTex = textTex(256, 320, null, (g, w, h) => {
  const gr = g.createRadialGradient(w * 0.5, h * 0.35, 10, w * 0.5, h * 0.5, h * 0.7);
  gr.addColorStop(0, '#ffcf8a'); gr.addColorStop(0.5, '#b87438'); gr.addColorStop(1, '#3a2010');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(120,40,30,0.75)'; g.fillRect(0, 0, w * 0.22, h); g.fillRect(w * 0.78, 0, w * 0.22, h);
});
const glowTex = textTex(128, 128, null, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const starTex = textTex(64, 64, null, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 64); g.moveTo(0, 32); g.lineTo(64, 32); g.stroke();
});

/* ---------- showroom textures ---------- */
// travertine cladding: 1.2 × 0.6 m panels (texture = 2.4 m square)
const travT = pair(1024, 1024, (g, w, h) => {
  g.fillStyle = '#d8cab1'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
    g.fillStyle = `hsla(37,${rand(14, 24)}%,${rand(72, 82)}%,0.55)`; g.fillRect(c * 512, r * 256, 512, 256);
  }
  for (let i = 0; i < 320; i++) { // travertine's horizontal veins and pores
    g.fillStyle = `rgba(${Math.random() < 0.55 ? '146,124,94' : '246,238,222'},${rand(0.08, 0.3)})`;
    g.fillRect(Math.random() * w, Math.random() * h, rand(30, 280), rand(1, 3.5));
  }
  fbm(g, w, h, { alpha: 0.18, base: 8 });
  g.fillStyle = 'rgba(70,58,42,0.6)';
  for (let r = 0; r <= 4; r++) g.fillRect(0, r * 256 - 1, w, 2);
  for (let c = 0; c <= 2; c++) g.fillRect(c * 512 - 1, 0, 2, h);
}, (g, w, h) => {
  g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(0,0,0,${rand(0.2, 0.6)})`; g.fillRect(Math.random() * w, Math.random() * h, rand(4, 40), rand(1, 3)); }
  g.fillStyle = '#111';
  for (let r = 0; r <= 4; r++) g.fillRect(0, r * 256 - 2, w, 4);
  for (let c = 0; c <= 2; c++) g.fillRect(c * 512 - 2, 0, 4, h);
});

// backlit onyx (used as an emissive panel): broad translucent bands, a few fine veins
const onyxTex = (() => {
  const c = makeCanvas(1024, 1024), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1024, 1024);
  gr.addColorStop(0, '#f2d7a2'); gr.addColorStop(0.45, '#e3ad66'); gr.addColorStop(1, '#f4ddb0');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
  const band = (n, wMin, wMax, alphaMin, alphaMax, light) => {
    for (let i = 0; i < n; i++) {
      g.strokeStyle = light ? `rgba(255,244,222,${rand(alphaMin, alphaMax)})` : `rgba(150,86,34,${rand(alphaMin, alphaMax)})`;
      g.lineWidth = rand(wMin, wMax);
      g.beginPath();
      const y0 = rand(-200, 1200), a = rand(40, 140), f = rand(0.5, 1.4), ph = rand(0, 6.28);
      for (let x = -40; x <= 1064; x += 12) {
        const y = y0 + Math.sin((x / 1024) * 6.28 * f + ph) * a + Math.sin(x / 90 + ph) * 8 + x * 0.25;
        x < 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  g.filter = 'blur(14px)';
  band(22, 40, 120, 0.1, 0.25, true);
  band(14, 20, 70, 0.08, 0.2, false);
  g.filter = 'blur(2px)';
  band(9, 1.5, 4, 0.2, 0.45, false);
  band(6, 1, 3, 0.25, 0.5, true);
  g.filter = 'none';
  fbm(g, 1024, 1024, { alpha: 0.1, base: 4 });
  return toTex(c, { tile: false });
})();

// polished Calacatta floor: 1.2 m tiles (texture = 2.4 m, 2 × 2 tiles)
const calacattaTex = (() => {
  const c = makeCanvas(1024, 1024), g = c.getContext('2d'), s = 512;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const t = makeCanvas(s, s);
    marbleCanvas(t.getContext('2d'), s, s, '#efebe3', 'rgba(118,112,104,0.32)');
    g.drawImage(t, i * s, j * s);
  }
  g.fillStyle = 'rgba(150,140,125,0.55)';
  for (let i = 0; i <= 2; i++) { g.fillRect(i * s - 1, 0, 2, 1024); g.fillRect(0, i * s - 1, 1024, 2); }
  return toTex(c);
})();

// dark flamed granite paving: 0.9 m slabs (texture = 1.8 m)
const graniteT = pair(512, 512, (g, w, h) => {
  g.fillStyle = '#3b3b3d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = `hsla(220,3%,${rand(20, 27)}%,0.6)`; g.fillRect(i * 256, j * 256, 256, 256); }
  for (let i = 0; i < 5000; i++) { const v = rand(0, 1); g.fillStyle = v < 0.5 ? `rgba(10,10,12,${rand(0.2, 0.6)})` : `rgba(190,188,184,${rand(0.1, 0.4)})`; g.fillRect(Math.random() * w, Math.random() * h, rand(1, 2.6), rand(1, 2.6)); }
  g.fillStyle = '#18181a';
  for (let i = 0; i <= 2; i++) { g.fillRect(i * 256 - 1.5, 0, 3, h); g.fillRect(0, i * 256 - 1.5, w, 3); }
}, (g, w, h) => {
  g.fillStyle = '#999'; g.fillRect(0, 0, w, h); fbm(g, w, h, { alpha: 0.8, base: 64, oct: 3 });
  g.fillStyle = '#000';
  for (let i = 0; i <= 2; i++) { g.fillRect(i * 256 - 2, 0, 4, h); g.fillRect(0, i * 256 - 2, w, 4); }
});

// halo-lit channel letters on a bronze fascia: colour map + separate glow (emissive) map
function haloSign(glowOnly) {
  const w = 2048, h = 200, c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = glowOnly ? '#000' : '#33251a'; g.fillRect(0, 0, w, h);
  if (!glowOnly) {
    fbm(g, w, h, { alpha: 0.12, base: 8 });
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1); // brushed metal
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '300 112px Sora, sans-serif'; g.letterSpacing = '64px';
  // the halo: letters lit from behind wash the fascia around them
  g.shadowColor = 'rgba(255,214,150,1)';
  for (const b of [70, 36, 14]) { g.shadowBlur = b; g.fillStyle = glowOnly ? '#000' : '#2a1d12'; g.fillText('AURELIA', w / 2 + 32, h * 0.52); }
  g.shadowBlur = 0;
  if (!glowOnly) {
    g.fillStyle = '#2a1d12'; g.fillText('AURELIA', w / 2 + 32, h * 0.52);
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(214,176,106,0.9)'; g.strokeText('AURELIA', w / 2 + 32, h * 0.52);
  }
  return toTex(c, { tile: false });
}
const haloColorTex = haloSign(false);
const haloGlowTex = haloSign(true);

// wall-wash "scallop" cast by a downlight close to a wall
const scallopTex = (() => {
  const w = 128, h = 256, c = makeCanvas(w, h), g = c.getContext('2d'), id = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / h, spread = 0.05 + 0.5 * Math.pow(v, 0.8);
    for (let x = 0; x < w; x++) {
      const u = (x / w - 0.5) / spread;
      let I = Math.exp(-u * u * 2.4) * (v < 0.05 ? v / 0.05 : 1) * Math.pow(1 - v, 1.4);
      I += Math.exp(-((x / w - 0.5) ** 2) / 0.0025 - ((v - 0.1) ** 2) / 0.004) * 0.7;
      id.data.set([255, 255, 255, clamp(I) * 255], (y * w + x) * 4);
    }
  }
  g.putImageData(id, 0, 0);
  return toTex(c, { tile: false });
})();

// dark bronze brand letters for the backlit onyx wall
const brandDarkTex = textTex(1024, 256, null, (g, w, h) => {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#7d1016';
  g.font = '500 118px "Cormorant Garamond", serif'; g.letterSpacing = '10px';
  g.fillText('KHANNA', w / 2 + 5, h * 0.38);
  g.fillStyle = '#6a4a1c';
  g.font = '500 58px "Cormorant Garamond", serif'; g.letterSpacing = '26px';
  g.fillText('GEMS', w / 2 + 13, h * 0.8);
});

/* =========================================================================
   "Sketch → solid" material system
   ========================================================================= */
const solidMats = [];
function reg(m, { glass = false, tile = 0 } = {}) {
  m.userData.base = m.opacity;
  m.userData.glass = glass;
  m.userData.tile = tile;
  m.polygonOffset = true;
  m.polygonOffsetFactor = 1;
  m.polygonOffsetUnits = 1;
  solidMats.push(m);
  return m;
}
const M = (params, opts) => reg(new THREE.MeshStandardMaterial({ roughness: 0.6, ...params }), opts);
const P = (params, opts) => reg(new THREE.MeshPhysicalMaterial({ roughness: 0.6, ...params }), opts);

let lastSolid = -1;
function setSolidity(s) {
  if (Math.abs(s - lastSolid) < 1e-4) return;
  lastSolid = s;
  for (const m of solidMats) {
    if (m.userData.glass) {
      m.transparent = true; m.depthWrite = false;
      m.opacity = m.userData.base * s;
      m.visible = s > 0.001;
      continue;
    }
    const wantT = s > 0.001 && s < 0.999;
    if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
    m.colorWrite = s > 0.001;
    m.opacity = s;
  }
}

/* ---------- ink outlines ---------- */
const lineMat = new LineMaterial({ color: 0x161616, linewidth: 1.3, transparent: true, opacity: 1 });
lineMat.resolution.set(innerWidth, innerHeight);
const outlines = [];
let OUTLINE = true;
function addOutline(mesh, threshold = 22) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, threshold);
  const g = new LineSegmentsGeometry().fromEdgesGeometry(eg);
  const l = new LineSegments2(g, lineMat);
  l.userData.total = eg.attributes.position.count / 2;
  g.instanceCount = 0;
  l.visible = false;
  mesh.add(l);
  outlines.push(l);
  eg.dispose();
}

// Box UVs in metres so tiled textures keep real-world scale on any box.
function tileUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const ox = Math.random(), oy = Math.random();
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, ox + (uv.getX(k) * dims[f][0]) / tile, oy + (uv.getY(k) * dims[f][1]) / tile);
  }
  uv.needsUpdate = true;
}

function mesh(geo, material, x = 0, y = 0, z = 0, parent = world, { outline = OUTLINE, cast = true, receive = true, thr } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  if (outline) addOutline(m, thr);
  return m;
}
function B(w, h, d, material, x, y, z, parent, opts) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (!Array.isArray(material) && material.userData.tile) tileUV(geo, w, h, d, material.userData.tile);
  return mesh(geo, material, x, y, z, parent, opts);
}
const C = (rt, rb, h, seg, material, x, y, z, parent, opts) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material, x, y, z, parent, opts);

/* ---------- glow sprites, light beams, lights ---------- */
const glows = [];
function glow(x, y, z, size, { color = '#ffd29a', opacity = 0.7, parent = world, interior = false } = {}) {
  const sm = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const s = new THREE.Sprite(sm);
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  s.userData = { base: opacity, interior };
  parent.add(s);
  glows.push(s);
  return s;
}

const beamMats = [];
function lightBeam(x, yTop, z, height, radius, color = '#ffd9a8', strength = 0.16) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f=pow(abs(dot(vN,vV)),2.0); float a=pow(1.0-vUv.y,1.6)*smoothstep(0.0,0.25,vUv.y)*f*uOpacity; gl_FragColor=vec4(uColor*a,a); }`,
  });
  m.userData.base = strength;
  beamMats.push(m);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, radius, height, 40, 1, true), m);
  cone.position.set(x, yTop - height / 2, z);
  cone.renderOrder = 5;
  world.add(cone);
}

const extLights = [];
const intLights = [];
function pLight(color, intensity, x, y, z, { interior = false, distance = 0 } = {}) {
  const l = new THREE.PointLight(color, 0, distance, 2);
  l.position.set(x, y, z);
  l.userData.base = intensity;
  scene.add(l);
  (interior ? intLights : extLights).push(l);
  return l;
}

/* =========================================================================
   Materials
   ========================================================================= */
const mat = {
  trav: M({ map: travT.map, bumpMap: travT.bump, bumpScale: 1.2, roughness: 0.78 }, { tile: 2.4 }),
  trav2: M({ map: travT.map, bumpMap: travT.bump, bumpScale: 1, color: '#e2d7c3', roughness: 0.74 }, { tile: 2.4 }),
  bronze: P({ color: '#5b3e24', metalness: 1, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
  bronzeLight: M({ color: '#a47a45', metalness: 1, roughness: 0.28 }),
  gold: M({ color: '#d4ad5a', metalness: 1, roughness: 0.22 }),
  granite: P({ map: graniteT.map, bumpMap: graniteT.bump, bumpScale: 0.6, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12 }, { tile: 1.8 }),
  lacquer: P({ color: '#0b0b0c', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 }),
  glass: P({ color: '#e3f0ef', roughness: 0.015, metalness: 0, opacity: 0.1, envMapIntensity: 2.4, specularIntensity: 1 }, { glass: true }),
  shelfGlass: P({ color: '#e6f2f0', roughness: 0.02, opacity: 0.35, envMapIntensity: 1.5 }, { glass: true }),
  onyx: M({ map: onyxTex, emissive: '#ffffff', emissiveMap: onyxTex, emissiveIntensity: 0.42, roughness: 0.55, envMapIntensity: 0.15 }),
  vitrineBack: M({ color: '#f1e7d6', emissive: '#ffe9c9', emissiveIntensity: 0.28, roughness: 0.6 }),
  led: M({ color: '#fff0d6', emissive: '#ffcf8a', emissiveIntensity: 3 }),
  lamp: M({ color: '#fff3d6', emissive: '#ffc46e', emissiveIntensity: 4 }),
  sign: P({ map: haloColorTex, emissive: '#ffd49a', emissiveMap: haloGlowTex, emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.38, clearcoat: 0.4 }),
  litWindow: M({ map: windowTex, emissive: '#ffffff', emissiveMap: windowTex, emissiveIntensity: 0.9, roughness: 0.15 }),
  darkWindow: P({ color: '#0f141b', roughness: 0.04, metalness: 0.3, clearcoat: 1 }),
  brick: M({ map: brickT.map, bumpMap: brickT.bump, bumpScale: 3, roughness: 0.92 }, { tile: 1.2 }),
  brick2: M({ map: brickT.map, bumpMap: brickT.bump, bumpScale: 3, color: '#8b8f96', roughness: 0.92 }, { tile: 1.2 }),
  stone2: M({ map: stoneT.map, bumpMap: stoneT.bump, bumpScale: 1, color: '#d9d0bf', roughness: 0.85 }, { tile: 3 }),
  asphalt: M({ map: asphaltT.map, bumpMap: asphaltT.bump, bumpScale: 1.2, roughness: 0.28, metalness: 0.15 }),
  plant: M({ color: '#2f5a33', roughness: 0.8, bumpMap: foliageBump, bumpScale: 4 }),
  iron: M({ color: '#16181b', roughness: 0.45, metalness: 0.7 }),
  // interior
  wall: M({ color: '#e4d2b4', roughness: 0.85, bumpMap: plasterT.bump, bumpScale: 0.4 }, { tile: 3 }),
  ceiling: M({ color: '#eadcc3', roughness: 0.95 }),
  floor: P({ map: calacattaTex, color: '#efe2cc', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 }, { tile: 2.4 }),
  walnut: P({ map: woodT.map, bumpMap: woodT.bump, bumpScale: 0.8, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.15 }, { tile: 1 }),
  marble: P({ map: marbleTex, color: '#cfc8bb', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 }, { tile: 1.5 }),
  velvet: P({ color: '#0f1631', roughness: 1, sheen: 0.5, sheenRoughness: 0.5, sheenColor: '#2e3a70' }),
  bustVelvet: P({ color: '#141416', roughness: 1, sheen: 0.7, sheenRoughness: 0.5, sheenColor: '#5a5a66' }),
  brandDark: M({ map: brandDarkTex, alphaTest: 0.4, roughness: 0.4, metalness: 0.6 }),
  crystal: P({ color: '#ffffff', roughness: 0, metalness: 0, transmission: 1, thickness: 0.05, ior: 1.6, envMapIntensity: 3, flatShading: true }),
  vase: P({ color: '#2b6a58', roughness: 0.05, transmission: 0.4, thickness: 0.2, clearcoat: 1 }),
  petal: P({ color: '#e9a9b8', roughness: 0.6, sheen: 1, sheenColor: '#ffd6e0' }),
  petal2: P({ color: '#f6f1e8', roughness: 0.6, sheen: 1, sheenColor: '#ffffff' }),
  leaf: M({ color: '#3d6b3a', roughness: 0.6 }),
  book: P({ color: '#5b1822', roughness: 0.55, bumpMap: leatherBump, bumpScale: 1, clearcoat: 0.3 }),
  // jewel box
  leather: P({ color: '#132042', roughness: 0.5, bumpMap: leatherBump, bumpScale: 0.25, clearcoat: 0.5, clearcoatRoughness: 0.3 }, { tile: 0.3 }),
  satin: P({ color: '#10183a', roughness: 0.9, sheen: 0.8, sheenRoughness: 0.45, sheenColor: '#3b4c96' }),
  slot: M({ color: '#0e0b08', roughness: 0.8 }),
};
const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.0001), y)), seg);
const sketchOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
// display stones: faceted, mirror-bright coloured facets (reads like real loose gems under shop lights)
const gemFacet = (c, glow = 0.12) => P({ color: c, metalness: 1, roughness: 0.05, envMapIntensity: 2.4, flatShading: true, emissive: c, emissiveIntensity: glow });
// navaratna palette: blue sapphire, ruby, emerald, diamond, yellow sapphire, hessonite
const displayGemMats = ['#3d6bff', '#e0184a', '#1db36f', '#eef2ff', '#ffc12e', '#d8732a'].map((c) => gemFacet(c));
const pearlMat = P({ color: '#f4efe6', roughness: 0.22, sheen: 1, sheenColor: '#ffe9f1', iridescence: 0.6, iridescenceIOR: 1.4, clearcoat: 1, envMapIntensity: 1.4 });
const catsEyeMat = P({ color: '#a9a13a', roughness: 0.18, clearcoat: 1, envMapIntensity: 1.6, emissive: '#5a4a10', emissiveIntensity: 0.2 });
const spinning = [];
const displayBrilliantGeo = brilliantGeo(), displayEmeraldGeo = emeraldGeo();
let displayGemCount = 0;
// one loose stone on a tiny brass cup: cycles through brilliant, step-cut, pearl and cabochon
function displayStone(size, idx, x, y, z, parent) {
  const kind = displayGemCount++ % 7;
  C(size * 0.55, size * 0.7, size * 0.35, 20, mat.bronzeLight, x, y + size * 0.17, z, parent, { cast: false });
  const top = y + size * 0.35;
  let g;
  if (kind === 5) {
    g = mesh(new THREE.SphereGeometry(size * 0.55, 32, 24), pearlMat, x, top + size * 0.5, z, parent, { cast: false });
  } else if (kind === 6) {
    g = mesh(new THREE.SphereGeometry(size * 0.6, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), catsEyeMat, x, top, z, parent, { cast: false });
    g.scale.set(1, 0.75, 0.75);
  } else {
    const geo = kind === 2 ? displayEmeraldGeo : displayBrilliantGeo;
    g = mesh(geo, displayGemMats[idx % displayGemMats.length], x, top + size * 0.45, z, parent, { cast: false });
    g.scale.setScalar(size * 0.9);
    g.rotation.set(0.5, Math.random() * 6.28, 0);
    spinning.push(g);
  }
  return g;
}

// light decals: additive planes for downlight pools, wall-wash scallops and wet-street reflections
function decal(tex, w, h, x, y, z, { rotX = 0, rotY = 0, color = '#ffd9a8', opacity = 0.5, interior = false, parent = world } = {}) {
  const m = new THREE.MeshBasicMaterial({
    map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const d = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  d.position.set(x, y, z);
  d.rotation.set(rotX, rotY, 0, 'YXZ');
  d.renderOrder = 3;
  parent.add(d);
  d.userData = { base: opacity, interior };
  glows.push(d);
  return d;
}
const floorPool = (x, y, z, w, d, opts) => decal(glowTex, w, d, x, y, z, { rotX: -Math.PI / 2, ...opts });

// area lights (soft, showroom-style); these need their LTC lookup tables
RectAreaLightUniformsLib.init();
function rectLight(color, intensity, w, h, pos, target, { interior = false } = {}) {
  const l = new THREE.RectAreaLight(color, 0, w, h);
  l.position.copy(pos);
  l.lookAt(target);
  l.userData.base = intensity;
  scene.add(l);
  (interior ? intLights : extLights).push(l);
  return l;
}

/* =========================================================================
   Interior — showroom
   ========================================================================= */
OUTLINE = false;
const I = new THREE.Group();
world.add(I);
B(12, 0.02, 10.9, mat.floor, 0, -0.01, -5.7, I, { cast: false });
B(12, 0.1, 10.9, mat.ceiling, 0, 4.65, -5.7, I, { cast: false });
// dropped perimeter bulkhead forming a lit coffer
B(12, 0.36, 1.3, mat.ceiling, 0, 4.42, -0.9, I, { cast: false });
B(12, 0.36, 1.2, mat.ceiling, 0, 4.42, -10.5, I, { cast: false });
for (const sx of [-1, 1]) B(1.2, 0.36, 8.3, mat.ceiling, sx * 5.4, 4.42, -5.7, I, { cast: false });
for (const [w, d, x, z] of [[9.6, 0.02, 0, -1.55], [9.6, 0.02, 0, -9.9], [0.02, 8.35, -4.8, -5.72], [0.02, 8.35, 4.8, -5.72]])
  B(w, 0.02, d, mat.led, x, 4.6, z, I, { cast: false });
decal(glowTex, 11, 11, 0, 4.598, -5.7, { rotX: Math.PI / 2, opacity: 0.14, color: '#ffd9a0', interior: true });
for (const sx of [-1, 1]) {
  B(0.2, 4.6, 10.9, mat.wall, sx * 6, 2.3, -5.7, I, { cast: false });
  B(0.03, 0.1, 10.9, mat.bronze, sx * 5.885, 0.05, -5.7, I);
}
B(12, 4.6, 0.2, mat.wall, 0, 2.3, -11.1, I, { cast: false });
B(12, 0.1, 0.03, mat.bronze, 0, 0.05, -10.985, I);

// downlights in the bulkhead: wall-wash scallops down the side walls, pools on the floor
for (const sx of [-1, 1]) for (const z of [-1.9, -3.9, -6.5, -9.1]) {
  C(0.05, 0.05, 0.01, 16, mat.led, sx * 5.45, 4.235, z, I, { cast: false });
  decal(scallopTex, 1.4, 4.1, sx * 5.895, 2.18, z, { rotY: -sx * Math.PI / 2, opacity: 0.32, interior: true });
}
for (const z of [-3.2, -5.4]) floorPool(0, 0.003, z, 2.4, 2.4, { opacity: 0.12, color: '#fff0dc', interior: true });

// back wall: a photographed walnut cabinet wall full of lit navaratna stones (generated plate)
backWallTex.colorSpace = THREE.SRGBColorSpace;
backWallTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const backWallMat = new THREE.MeshBasicMaterial({ map: backWallTex, toneMapped: false });
const BW_H = 4.6, BW_W = BW_H * (backWallTex.image.width / backWallTex.image.height);
mesh(new THREE.PlaneGeometry(BW_W, BW_H), backWallMat, 0, BW_H / 2, -10.97, I, { cast: false });
rectLight('#ffc98a', 0.6, BW_W * 0.8, 2.6, V(0, 2.3, -10.9), V(0, 2.3, 0), { interior: true });

// tall wall vitrines: backlit, glass shelves, LED head
function vitrine(x, z, rotY, seed) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  I.add(g);
  const w = 1.7, d = 0.55;
  B(w, 0.9, d, mat.walnut, 0, 0.45, 0, g);
  B(w, 0.02, d, mat.bronzeLight, 0, 0.91, 0, g);
  B(w, 1.6, d, mat.glass, 0, 1.72, 0, g, { cast: false });
  B(w - 0.04, 1.58, 0.02, mat.vitrineBack, 0, 1.72, -d / 2 + 0.02, g, { cast: false });
  B(w + 0.04, 0.12, d + 0.04, mat.walnut, 0, 2.58, 0, g);
  B(w + 0.05, 0.015, d + 0.05, mat.bronzeLight, 0, 2.515, 0, g);
  B(w - 0.1, 0.012, 0.03, mat.led, 0, 2.515, d / 2 - 0.06, g, { cast: false });
  for (const px of [-w / 2, w / 2]) B(0.03, 1.6, 0.03, mat.bronze, px, 1.72, d / 2 - 0.015, g);
  [1.3, 1.78, 2.24].forEach((y, k) => {
    B(w - 0.06, 0.012, d - 0.06, mat.shelfGlass, 0, y, 0, g, { cast: false });
    for (let i = 0; i < 4; i++) {
      displayStone(0.05, i + k + seed, -0.6 + i * 0.4, y + 0.006, 0.02, g);
    }
  });
  glow(0, 1.8, 0.1, 1.8, { opacity: 0.12, interior: true, parent: g });
  return g;
}
for (const sx of [-1, 1]) {
  [-2.7, -5.2, -7.7].forEach((z, i) => vitrine(sx * 5.58, z, -sx * Math.PI / 2, i * 2 + (sx > 0 ? 1 : 0)));
}

// island showcases
for (const sx of [-1, 1]) {
  const x = sx * 2.7, z = -4.3;
  B(1.4, 0.85, 0.8, mat.walnut, x, 0.425, z, I);
  B(1.44, 0.02, 0.84, mat.bronzeLight, x, 0.86, z, I);
  B(1.34, 0.01, 0.74, mat.velvet, x, 0.875, z, I);
  B(1.4, 0.3, 0.8, mat.glass, x, 1.03, z, I, { cast: false });
  for (let k = 0; k < 3; k++)
    displayStone(0.055, k + (sx > 0 ? 3 : 0), x - 0.4 + k * 0.4, 0.88, z, I);
  glow(x, 1.0, z, 1.2, { opacity: 0.12, interior: true });
  floorPool(x, 0.003, z, 2.2, 1.8, { opacity: 0.1, color: '#fff0dc', interior: true });
}

// crystal chandelier
{
  const ch = new THREE.Group();
  ch.position.set(0, 3.55, -4.6);
  I.add(ch);
  C(0.006, 0.006, 0.9, 6, mat.bronzeLight, 0, 0.62, 0, ch, { cast: false });
  const crystalGeo = new THREE.OctahedronGeometry(0.03, 0);
  [[0.75, 0], [0.5, -0.18], [0.26, -0.34]].forEach(([r, y], ri) => {
    const ring = mesh(new THREE.TorusGeometry(r, 0.012, 8, 64), mat.gold, 0, y, 0, ch, { cast: false });
    ring.rotation.x = Math.PI / 2;
    const n = Math.round(r * 44);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, drop = 0.1 + ((i + ri) % 3) * 0.06;
      mesh(crystalGeo, mat.crystal, Math.cos(a) * r, y - drop, Math.sin(a) * r, ch, { cast: false }).scale.y = 1.8;
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      C(0.004, 0.004, 0.62 - y, 4, mat.bronzeLight, Math.cos(a) * r, (0.62 + y) / 2, Math.sin(a) * r, ch, { cast: false });
    }
  });
  glow(0, 3.25, -4.6, 1.4, { opacity: 0.5, interior: true });
  pLight('#ffe4bf', 7, 0, 3.3, -4.6, { interior: true });
}

// soft ceiling light from the coffer
rectLight('#ffd9a6', 0.8, 8.5, 3.2, V(0, 4.56, -3.6), V(0, 0, -3.6), { interior: true });
rectLight('#ffd9a6', 0.6, 8.5, 3.2, V(0, 4.56, -7.6), V(0, 0, -7.6), { interior: true });

// pendants over the counter
const shadeMat = reg(new THREE.MeshPhysicalMaterial({ color: '#d4ad5a', metalness: 1, roughness: 0.25, side: THREE.DoubleSide }));
for (const x of [-1.25, 1.25]) {
  C(0.006, 0.006, 1.3, 6, mat.iron, x, 3.95, -7.9, I, { cast: false });
  mesh(new THREE.ConeGeometry(0.24, 0.28, 48, 1, true), shadeMat, x, 3.2, -7.9, I, { cast: false });
  mesh(new THREE.SphereGeometry(0.07, 20, 14), mat.lamp, x, 3.1, -7.9, I, { cast: false });
  glow(x, 3.05, -7.9, 0.9, { opacity: 0.45, interior: true });
  pLight('#ffd49a', 5, x, 2.95, -7.9, { interior: true });
  lightBeam(x, 3.1, -7.9, 2.1, 0.75, '#ffd9a8', 0.1);
}

// the counter: walnut with a marble top and bronze trim
B(3.2, 0.95, 1.0, mat.walnut, 0, 0.475, -8.0, I);
B(3.3, 0.08, 1.1, mat.lacquer, 0, 0.04, -8.0, I);
B(3.22, 0.04, 1.02, mat.bronzeLight, 0, 0.9, -8.0, I);
B(3.4, 0.06, 1.15, mat.marble, 0, 0.98, -8.0, I);
B(1.0, 0.01, 0.7, mat.velvet, 0, 1.015, -7.85, I);
for (const x of [-1.05, -0.35, 0.35, 1.05]) {
  B(0.5, 0.6, 0.02, mat.walnut, x, 0.5, -7.49, I);
  B(0.52, 0.62, 0.01, mat.bronzeLight, x, 0.5, -7.495, I);
}
floorPool(0, 0.003, -7.2, 3.6, 1.6, { opacity: 0.1, color: '#fff0dc', interior: true });

// flowers
C(0.06, 0.085, 0.3, 32, mat.vase, -1.25, 1.16, -8.05, I);
for (let k = 0; k < 9; k++) {
  const a = (k / 9) * Math.PI * 2, r = k === 0 ? 0 : 0.07;
  const fx = -1.25 + Math.cos(a) * r, fz = -8.05 + Math.sin(a) * r, fy = 1.4 + Math.sin(k * 1.7) * 0.04;
  C(0.004, 0.004, 0.2, 5, mat.leaf, fx * 0.5 + -1.25 * 0.5, fy - 0.1, fz * 0.5 + -8.05 * 0.5, I, { cast: false });
  const f = mesh(new THREE.SphereGeometry(0.042, 16, 12), k % 3 ? mat.petal : mat.petal2, fx, fy, fz, I);
  f.scale.y = 0.75;
}
B(0.3, 0.035, 0.22, mat.book, 1.15, 1.03, -8.0, I).rotation.y = 0.35;
C(0.05, 0.06, 0.012, 24, mat.gold, 0.85, 1.016, -7.7, I);
mesh(new THREE.TorusGeometry(0.022, 0.006, 10, 24), mat.gold, 0.85, 1.03, -7.7, I).rotation.x = Math.PI / 2;

// dust motes drifting in the light
const dustGeo = new THREE.BufferGeometry();
{
  const n = 220, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([rand(-3, 3), rand(0.4, 3.8), rand(-10, -3)], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(a, 3));
}
const dustMat = new THREE.PointsMaterial({ map: glowTex, size: 0.016, color: '#ffe6c2', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// night sky: stars + moon
const starsGeo = new THREE.BufferGeometry();
{
  const n = 500, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([rand(-90, 90), rand(14, 60), rand(-80, -40)], i * 3);
  starsGeo.setAttribute('position', new THREE.BufferAttribute(a, 3));
}
const starsMat = new THREE.PointsMaterial({ map: glowTex, size: 0.35, color: '#cfd8ff', transparent: true, depthWrite: false, opacity: 0, fog: false });
scene.add(new THREE.Points(starsGeo, starsMat));
const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#eef2ff', transparent: true, opacity: 0, fog: false, depthWrite: false }));
moon.position.set(-38, 34, -70);
moon.scale.setScalar(9);
scene.add(moon);

/* =========================================================================
   The salesperson — a filmed namaste clip, chroma-keyed onto a card
   behind the counter and scrubbed frame by frame with the scroll.
   ========================================================================= */
const assocTex = new THREE.Texture(assocFrames[0]);
assocTex.colorSpace = THREE.SRGBColorSpace;
assocTex.minFilter = THREE.LinearFilter;
assocTex.generateMipmaps = false;
assocTex.needsUpdate = true;
const assocMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    map: { value: assocTex },
    uKey: { value: new THREE.Color('#246d35') }, // sampled from the clip's backdrop
    uBright: { value: 1.25 },
    uOpacity: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D map; uniform vec3 uKey; uniform float uBright; uniform float uOpacity; varying vec2 vUv;
    vec2 cc(vec3 c){ return vec2(-0.1687*c.r-0.3313*c.g+0.5*c.b, 0.5*c.r-0.4187*c.g-0.0813*c.b); }
    void main(){
      vec3 c = texture2D(map, vUv).rgb;
      // key in (roughly perceptual) sRGB space for a cleaner matte
      vec3 s = pow(c, vec3(1.0/2.2)), k = pow(uKey, vec3(1.0/2.2));
      float d = distance(cc(s), cc(k));
      float a = smoothstep(0.07, 0.16, d);
      // only green-dominant pixels may be keyed: dark hair (neutral, low chroma) stays fully opaque,
      // so the bright wall can no longer shimmer through it
      float gd = s.g - max(s.r, s.b);
      a = max(a, 1.0 - smoothstep(0.03, 0.11, gd));
      // despill: clamp green to the other channels
      c.g = min(c.g, max(c.r, c.b) * 1.02 + 0.01);
      // deepen the darkest tones (hair) to a clean natural black
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(0.72, 1.0, smoothstep(0.015, 0.06, luma));
      // soft vignette on the card edges so no hard border ever shows
      float e = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(1.0, 0.985, vUv.y);
      a *= e * uOpacity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(c * uBright, a);
    }`,
});
const ASSOC_H = 1.08, ASSOC_BOTTOM = 0.68;
const associate = new THREE.Mesh(new THREE.PlaneGeometry(ASSOC_H * (9 / 16), ASSOC_H), assocMat);
associate.position.set(0, ASSOC_BOTTOM + ASSOC_H / 2, -8.8);
associate.renderOrder = 2;
I.add(associate);

let assocFrame = -1;
function setAssocFrame(f) {
  f = clamp(Math.round(f), 0, assocFrames.length - 1);
  if (f === assocFrame) return;
  assocFrame = f;
  assocTex.image = assocFrames[f];
  assocTex.needsUpdate = true;
}
// idle frames: gentle ping-pong in the still sections so she never looks frozen
const FPS = frameInfo.fps, LAST = assocFrames.length - 1;
const pingpong = (t, a, b) => { const n = b - a; const k = t % (2 * n); return a + (k < n ? k : 2 * n - k); };
function associateFrame(p, t) {
  const g = ramp(p, 0.43, 0.585);
  if (g <= 0) return pingpong(t * FPS * 0.6, 0, Math.min(FPS * 0.9, LAST));
  if (g >= 1) return pingpong(t * FPS * 0.6, Math.max(0, LAST - FPS), LAST);
  return g * LAST;
}

/* =========================================================================
   Jewel box + gemstone
   ========================================================================= */
const jbox = new THREE.Group();
jbox.position.set(0, 1.02, -7.85);
I.add(jbox);
B(0.36, 0.13, 0.28, mat.leather, 0, 0.065, 0, jbox);
B(0.365, 0.012, 0.285, mat.gold, 0, 0.124, 0, jbox);
B(0.32, 0.012, 0.24, mat.satin, 0, 0.136, 0, jbox);
B(0.13, 0.004, 0.012, mat.slot, 0, 0.1425, 0, jbox);
for (const sx of [-1, 1]) B(0.02, 0.012, 0.02, mat.gold, sx * 0.16, 0.006, 0.12, jbox);
const lid = new THREE.Group();
lid.position.set(0, 0.13, -0.14);
jbox.add(lid);
B(0.36, 0.07, 0.28, mat.leather, 0, 0.035, 0.14, lid);
B(0.33, 0.004, 0.25, mat.satin, 0, -0.001, 0.14, lid);
B(0.365, 0.01, 0.285, mat.gold, 0, 0.006, 0.14, lid);
B(0.045, 0.03, 0.012, mat.gold, 0, 0.02, 0.284, lid);

// Real faceting: convex hulls of the facet-junction points.
function brilliantGeo() {
  const pts = [];
  const add = (r, a, y) => pts.push(V(r * Math.cos(a), y, r * Math.sin(a)));
  const T = Math.PI / 4;
  for (let k = 0; k < 8; k++) {
    add(0.54, k * T, 0.35);                 // table
    add(0.8, (k + 0.5) * T, 0.195);         // star facet tips
    add(0.52, (k + 0.5) * T, -0.43);        // lower-girdle / pavilion-main junctions
  }
  for (let k = 0; k < 32; k++) { add(1, (k * Math.PI) / 16, 0.018); add(1, (k * Math.PI) / 16, -0.018); } // girdle
  for (let k = 0; k < 16; k++) add(0.975, (k + 0.5) * (Math.PI / 8), 0.06); // upper girdle facets
  pts.push(V(0, -0.87, 0));                 // culet
  const g = new ConvexGeometry(pts);
  g.computeVertexNormals();
  return g;
}
function emeraldGeo() {
  const pts = [];
  const oct = (s, y) => {
    const hx = 1.25 * s, hz = 0.9 * s, c = 0.26 * s;
    [[hx - c, hz], [hx, hz - c], [hx, -hz + c], [hx - c, -hz], [-hx + c, -hz], [-hx, -hz + c], [-hx, hz - c], [-hx + c, hz]]
      .forEach(([x, z]) => pts.push(V(x, y, z)));
  };
  oct(1, 0.02); oct(1, -0.02); oct(0.86, 0.15); oct(0.7, 0.27); oct(0.62, 0.3);
  oct(0.78, -0.2); oct(0.52, -0.4); oct(0.3, -0.53);
  pts.push(V(0.35, -0.6, 0), V(-0.35, -0.6, 0));
  const g = new ConvexGeometry(pts);
  g.computeVertexNormals();
  return g;
}
const GEO = { brilliant: brilliantGeo(), emerald: emeraldGeo() };

const GEMS = {
  emerald: {
    label: 'Emerald', name: 'Colombian Emerald', sub: 'Panna · Mercury (Budh) · Govt. lab certified',
    color: '#2ee08f', att: '#02703c', attD: 0.07, ior: 1.58, disp: 0.5, cut: 'emerald', glow: '#1fd680',
    specs: [['Carat', '5.25 ct'], ['Cut', 'Emerald Step Cut'], ['Clarity', 'Eye clean · Natural jardin'], ['Colour', 'Vivid Green'],
      ['Planet', 'Mercury (Budh)'], ['Origin', 'Muzo, Colombia'], ['Treatment', 'Natural · Unused'], ['Certification', 'Govt. Lab Certified']],
  },
  sapphire: {
    label: 'Blue Sapphire', name: 'Ceylon Blue Sapphire', sub: 'Neelam · Saturn (Shani) · Unheated',
    color: '#4d7dff', att: '#0b2fb8', attD: 0.06, ior: 1.77, disp: 0.9, cut: 'brilliant', glow: '#4f7fff',
    specs: [['Carat', '4.10 ct'], ['Cut', 'Round Brilliant'], ['Clarity', 'VVS · Eye clean'], ['Colour', 'Royal Blue'],
      ['Planet', 'Saturn (Shani)'], ['Origin', 'Ratnapura, Sri Lanka'], ['Treatment', 'Non-heated · Untreated'], ['Certification', 'Govt. Lab Certified']],
  },
  ruby: {
    label: 'Ruby', name: 'Burmese Ruby', sub: 'Manik · Sun (Surya) · Unheated',
    color: '#ff3a60', att: '#a3001c', attD: 0.06, ior: 1.77, disp: 0.9, cut: 'brilliant', glow: '#ff2d55',
    specs: [['Carat', '3.05 ct'], ['Cut', 'Round Brilliant'], ['Clarity', 'VS · Eye clean'], ['Colour', "Pigeon's Blood Red"],
      ['Planet', 'Sun (Surya)'], ['Origin', 'Mogok, Myanmar'], ['Treatment', 'Non-heated · Untreated'], ['Certification', 'Govt. Lab Certified']],
  },
  yellowSapphire: {
    label: 'Yellow Sapphire', name: 'Ceylon Yellow Sapphire', sub: 'Pukhraj · Jupiter (Guru) · Unheated',
    color: '#ffc629', att: '#b86e00', attD: 0.07, ior: 1.77, disp: 0.9, cut: 'brilliant', glow: '#ffbf30',
    specs: [['Carat', '5.60 ct'], ['Cut', 'Round Brilliant'], ['Clarity', 'VVS · Eye clean'], ['Colour', 'Canary Yellow'],
      ['Planet', 'Jupiter (Guru)'], ['Origin', 'Sri Lanka'], ['Treatment', 'Non-heated · Untreated'], ['Certification', 'Govt. Lab Certified']],
  },
  diamond: {
    label: 'Diamond', name: 'Natural Diamond', sub: 'Heera · Venus (Shukra) · D colour',
    color: '#ffffff', att: '#ffffff', attD: 10, ior: 2.42, disp: 7, cut: 'brilliant', glow: '#dfe8ff',
    specs: [['Carat', '1.51 ct'], ['Cut', 'Round Brilliant'], ['Clarity', 'VVS2'], ['Colour', 'D · Colourless'],
      ['Planet', 'Venus (Shukra)'], ['Origin', 'Botswana'], ['Treatment', 'Natural · Untreated'], ['Certification', 'Govt. Lab Certified']],
  },
};

// Two layers: mirror-like coloured back facets (the stone's internal reflections)
// seen through a clear, refracting, dispersive front surface.
const gemMat = new THREE.MeshPhysicalMaterial({
  roughness: 0, metalness: 0, transmission: 1, thickness: 0.35, ior: 1.77,
  specularIntensity: 1, envMap: envTex, envMapIntensity: 1.6, flatShading: true,
});
const gemInnerMat = new THREE.MeshStandardMaterial({
  side: THREE.BackSide, metalness: 1, roughness: 0.04, envMap: envTex, envMapIntensity: 2.2, flatShading: true,
});
const coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });

const gemRoot = new THREE.Group();
scene.add(gemRoot);
const gemMesh = new THREE.Mesh(GEO.brilliant, gemMat);
gemRoot.add(gemMesh);
const gemInner = new THREE.Mesh(GEO.brilliant, gemInnerMat);
gemInner.scale.setScalar(0.985);
gemMesh.add(gemInner);
const gemCore = new THREE.Mesh(GEO.brilliant, coreMat);
gemCore.scale.setScalar(0.5);
gemMesh.add(gemCore);

const gemHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
scene.add(gemHalo);

function makeSparks(n, size) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.26 + Math.random() * 0.45;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ map: starTex, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const pts = new THREE.Points(g, m);
  scene.add(pts);
  return pts;
}
const sparksA = makeSparks(50, 0.035);
const sparksB = makeSparks(30, 0.06);

const boxLight = new THREE.PointLight('#5a86ff', 0, 2.5, 2);
boxLight.position.set(0, 1.4, -7.75);
const keyLight = new THREE.PointLight('#ffffff', 0, 0, 2);
keyLight.position.set(0.9, 2.3, -6.9);
const fillLight = new THREE.PointLight('#fff4e0', 0, 0, 2);
fillLight.position.set(-1.0, 1.9, -6.8);
const rimLight = new THREE.PointLight('#5a86ff', 0, 0, 2);
rimLight.position.set(-0.6, 1.4, -8.6);
scene.add(boxLight, keyLight, fillLight, rimLight);

let currentGem = 'emerald';
function applyGem(key) {
  const d = GEMS[key];
  currentGem = key;
  gemMesh.geometry = GEO[d.cut];
  gemCore.geometry = gemInner.geometry = gemMesh.geometry;
  gemMat.color.set(d.color).lerp(new THREE.Color('#ffffff'), d.cut === 'emerald' ? 0.3 : 0.28);
  gemMat.attenuationColor.set(d.att);
  gemMat.attenuationDistance = d.attD * 4;
  gemInnerMat.color.set(d.att).lerp(new THREE.Color(d.color), 0.5);
  gemInnerMat.envMapIntensity = key === 'diamond' ? 1.1 : 2.4;
  gemMat.envMapIntensity = key === 'diamond' ? 1.0 : 1.4;
  gemMat.ior = d.ior;
  gemMat.dispersion = d.disp;
  coreMat.color.set(d.glow);
  gemHalo.material.color.set(d.glow);
  sparksB.material.color.set(d.glow);
  boxLight.color.set(d.glow);
  rimLight.color.set(d.glow);
}
applyGem(currentGem);

/* =========================================================================
   Lighting
   ========================================================================= */
const hemi = new THREE.HemisphereLight('#ffe6c4', '#3a2a18', 0);
scene.add(hemi);
const moonLight = new THREE.DirectionalLight('#b9c9ff', 0);
moonLight.position.set(-12, 18, 20);
scene.add(moonLight);

const faceLight = pLight('#ffe7cc', 3, 0.5, 2.2, -7.0, { interior: true });

const spot = new THREE.SpotLight('#fff0d8', 0, 10, 0.5, 0.75, 1.6);
spot.position.set(0, 4.5, -7.3);
spot.target.position.set(0, 1, -7.9);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.bias = -0.0003;
spot.shadow.normalBias = 0.02;
spot.userData.base = 24;
scene.add(spot, spot.target);
intLights.push(spot);

/* =========================================================================
   Order outlines for the intro drawing (ground up)
   ========================================================================= */
scene.updateMatrixWorld(true);
const _p = new THREE.Vector3();
outlines.forEach((l) => {
  l.getWorldPosition(_p);
  l.userData.order = _p.y + Math.abs(_p.x) * 0.12 + Math.random() * 0.8;
});
outlines.sort((a, b) => a.userData.order - b.userData.order);

/* =========================================================================
   Camera path
   ========================================================================= */
const KEYS = [
  [0.0, [0, 1.9, -0.2], [0, 1.65, -8]],
  [0.2, [0, 1.9, -0.25], [0, 1.65, -8]],
  [0.33, [0, 1.88, -0.4], [0, 1.64, -8]],
  [0.39, [0, 1.8, -2.0], [0, 1.6, -8]],
  [0.46, [0, 1.72, -4.9], [0, 1.42, -8.6]],
  [0.55, [0, 1.7, -5.1], [0, 1.44, -8.6]],
  [0.64, [0, 1.56, -6.5], [0, 1.12, -7.85]],
  [0.75, [0, 1.62, -6.38], [0, 1.53, -7.85]],
  [1.0, [0, 1.6, -6.42], [0, 1.55, -7.85]],
];
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => V(...k[1])), false, 'catmullrom', 0.35);
const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => V(...k[2])), false, 'catmullrom', 0.35);
const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
function cameraAt(p) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++;
  const local = clamp((p - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]));
  const u = (i + local) / (KEYS.length - 1);
  posCurve.getPoint(u, camPos);
  tgtCurve.getPoint(u, camTgt);
}

/* =========================================================================
   DOM
   ========================================================================= */
const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const captions = [...document.querySelectorAll('.caption[data-range]')].map((el) => ({ el, r: el.dataset.range.split(',').map(Number) }));
const specL = $('#spec-l'), specR = $('#spec-r');
const gemHead = $('.gem-head'), dragHint = $('.drag-hint'), stoneBar = $('.stone-bar');
const scrollHint = $('.scroll-hint'), progressBar = $('.progress span');
const scrim = $('.scrim'), badges = $('#badges'), vignette = $('.vignette'), topbar = $('.topbar'), chaptersEl = $('#chapters');

function renderSpecs() {
  const d = GEMS[currentGem];
  $('#gem-name').textContent = d.name;
  $('#gem-sub').textContent = d.sub;
  const li = ([k, v]) => `<li class="spec"><span class="k">${k}</span><span class="v">${v}</span><span class="rule"></span></li>`;
  specL.innerHTML = d.specs.slice(0, 4).map(li).join('');
  specR.innerHTML = d.specs.slice(4).map(li).join('');
}
renderSpecs();
const specItems = () => [...specL.children, ...specR.children];

const picker = $('#picker');
picker.innerHTML = Object.entries(GEMS).map(([k, d]) =>
  `<button class="gem-btn${k === currentGem ? ' active' : ''}" data-gem="${k}" style="--c:${d.glow}"><i></i><span>${d.label}</span></button>`).join('');
let spinBoost = 0;
picker.addEventListener('click', (e) => {
  const b = e.target.closest('.gem-btn');
  if (!b || b.dataset.gem === currentGem) return;
  picker.querySelectorAll('.gem-btn').forEach((x) => x.classList.toggle('active', x === b));
  const swapEls = [gemHead, specL, specR];
  swapEls.forEach((el) => el.classList.add('swap', 'swapping'));
  spinBoost = 1;
  setTimeout(() => {
    applyGem(b.dataset.gem);
    renderSpecs();
    swapEls.forEach((el) => el.classList.remove('swapping'));
  }, 260);
});

const CHAPTERS = [['Sketch', 0], ['Boutique', 0.2], ['Enter', 0.36], ['Welcome', 0.5], ['Reveal', 0.63], ['The Stone', 0.86]];
chaptersEl.innerHTML = CHAPTERS.map(([n, p]) => `<button data-goto="${p}"><span>${n}</span><i></i></button>`).join('');
const chapterBtns = [...chaptersEl.children];

const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto]');
  if (!a) return;
  e.preventDefault();
  window.scrollTo({ top: Number(a.dataset.goto) * maxScroll(), behavior: 'smooth' });
});

let pTarget = 0;
const onScroll = () => { pTarget = clamp(window.scrollY / Math.max(1, maxScroll())); };
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
});

let dragging = false, lastX = 0, dragVel = 0, dragRot = 0, gemInteractive = false;
canvas.addEventListener('pointerdown', (e) => {
  if (!gemInteractive) return;
  dragging = true; lastX = e.clientX;
  canvas.classList.add('grabbing');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  dragVel = dx * 0.012;
  dragRot += dragVel;
});
const endDrag = () => { dragging = false; canvas.classList.remove('grabbing'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  lineMat.resolution.set(innerWidth, innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

/* =========================================================================
   Frame update
   ========================================================================= */
const INK = new THREE.Color('#161616'), GOLD = new THREE.Color('#d6b46a');
const FG_DARK = new THREE.Color('#161616'), FG_LIGHT = new THREE.Color('#f3ead8');
const _c = new THREE.Color();
let introStart = performance.now() + 700; // a beat of blank white page before the pen starts
let p = pTarget;
const clock = new THREE.Clock();
let spinAcc = 0;
const focusPt = new THREE.Vector3();

function update() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  p += (pTarget - p) * (1 - Math.exp(-dt * 4.5));

  /* --- 1-3. the storefront: pen sketch → photograph → doors open → zoom through the doorway --- */
  const intro = clamp((performance.now() - introStart) / 3800);
  const s = eramp(p, 0.015, 0.15); // how far the page has turned from white sketch to night photo
  const u = ovMat.uniforms;
  u.uDraw.value = Math.max(intro, ramp(p, 0, 0.04));
  u.uPhoto.value = s;
  u.uOpen.value = eramp(p, 0.21, 0.28);
  u.uZoom.value = 1 + Math.pow(ramp(p, 0.16, 0.335), 1.8) * 2.3;
  const through = ramp(p, 0.31, 0.35);
  u.uFlash.value = Math.sin(Math.PI * through) * 0.55;
  u.uAlpha.value = 1 - ease(through);
  u.uParallax.value.set(mouse.sx * 0.006 * (1 - s * 0.5), -mouse.sy * 0.004);
  u.uTime.value = t;
  const aspect0 = innerWidth / innerHeight, R = 3840 / 2144;
  if (aspect0 > R) u.uScale.value.set(1, R / aspect0); else u.uScale.value.set(aspect0 / R, 1);
  setSolidity(1);
  setBackground(1);
  document.body.classList.toggle('dark', s > 0.5);

  const inside = 1;
  const dim = 1 - 0.8 * eramp(p, 0.66, 0.8);
  const fin = eramp(p, 0.74, 0.84);

  hemi.intensity = s * lerp(0.5, 0.22, inside) * dim;
  moonLight.intensity = s * 0.45 * (1 - inside);
  scene.environmentIntensity = s * lerp(0.25, 0.45, inside) * dim;
  for (const l of extLights) l.intensity = l.userData.base * s * (1 - inside * 0.6);
  for (const l of intLights) l.intensity = l.userData.base * s * dim;
  for (const g of glows) g.material.opacity = g.userData.base * s * (g.userData.interior ? dim : 1);
  for (const m of beamMats) m.uniforms.uOpacity.value = m.userData.base * s * dim;
  mat.sign.emissiveIntensity = 2.2 * s;
  starsMat.opacity = s * 0.8 * (1 - inside);
  moon.material.opacity = s * 0.9 * (1 - inside);
  dustMat.opacity = s * inside * 0.55 * dim;
  dust.rotation.y = Math.sin(t * 0.05) * 0.05;
  dust.position.y = Math.sin(t * 0.2) * 0.05;
  bloom.strength = eramp(s, 0.55, 1) * lerp(0.55, 0.45, fin);
  bloom.threshold = lerp(0.95, 0.88, fin);

  /* --- 4. salesperson: the namaste clip is driven by scroll --- */
  associate.visible = p > 0.2;
  if (associate.visible) setAssocFrame(associateFrame(p, t));
  assocMat.uniforms.uBright.value = 1.3 * lerp(1, 0.45, 1 - dim);
  backWallMat.color.setScalar(lerp(0.3, 1, dim));

  /* --- 5. box opens --- */
  const open = eramp(p, 0.585, 0.65);
  lid.rotation.x = -open * 1.95;

  /* --- 6. gem rises, 7. rotates --- */
  const rise = eramp(p, 0.655, 0.76);
  const gemVisible = p > 0.35;
  gemRoot.visible = gemHalo.visible = sparksA.visible = sparksB.visible = gemVisible;
  gemRoot.position.set(0, lerp(1.02 + 0.162, 1.55, rise) + Math.sin(t * 1.4) * 0.012 * rise, -7.85 + rise * 0.02);
  gemRoot.scale.setScalar(lerp(0.042, 0.2, rise));

  spinBoost *= Math.exp(-dt * 2.2);
  if (!dragging) { dragVel *= Math.exp(-dt * 3); dragRot += dragVel; }
  spinAcc += dt * (0.12 + rise * 0.35 + spinBoost * 6);
  gemMesh.rotation.y = spinAcc + ramp(p, 0.74, 1) * Math.PI * 3 + dragRot;
  gemMesh.rotation.x = rise * 0.45 + Math.sin(t * 0.7) * 0.06 * rise;
  gemMesh.rotation.z = Math.sin(t * 0.5) * 0.05 * rise;
  coreMat.opacity = (0.06 + 0.1 * open) * (currentGem === 'diamond' ? 0.3 : 1);

  gemHalo.position.copy(gemRoot.position).add(V(0, 0, -0.2));
  gemHalo.scale.setScalar(lerp(0.25, 1.1, rise));
  gemHalo.material.opacity = open * 0.08 + fin * 0.06;
  for (const [sp, ph] of [[sparksA, 0], [sparksB, 2]]) {
    sp.position.copy(gemRoot.position);
    sp.rotation.y = t * (ph ? -0.12 : 0.18);
    sp.material.opacity = rise * (0.45 + 0.4 * Math.sin(t * 2.3 + ph));
  }
  boxLight.intensity = open * (1 - rise) * 0.35;
  keyLight.intensity = rise * 2.2;
  fillLight.intensity = rise * 0.8;
  rimLight.intensity = rise * 2.5;

  for (const g of spinning) g.rotation.y += dt * 0.6;

  /* --- camera --- */
  cameraAt(p);
  const aspect = innerWidth / innerHeight;
  if (aspect < 1) {
    const f = 1 + (1 - aspect) * 0.95;
    camPos.sub(camTgt).multiplyScalar(f).add(camTgt);
    camTgt.y -= 0.22 * fin;
  }
  mouse.sx += (mouse.x - mouse.sx) * 0.05;
  mouse.sy += (mouse.y - mouse.sy) * 0.05;
  const par = lerp(1, 0.12, inside) * (1 - fin * 0.6);
  camPos.x += mouse.sx * 0.6 * par;
  camPos.y -= mouse.sy * 0.25 * par;
  camera.position.copy(camPos);
  camera.lookAt(camTgt);

  /* --- depth of field: on the salesperson, then on the stone --- */
  const dofOn = eramp(p, 0.4, 0.46);
  bokeh.enabled = dofOn > 0.01;
  if (bokeh.enabled) {
    focusPt.set(0, 1.55, -8.9).lerp(gemRoot.position, eramp(p, 0.56, 0.66));
    bokeh.uniforms.focus.value = camera.position.distanceTo(focusPt);
    bokeh.uniforms.aperture.value = dofOn * lerp(0.0025, 0.012, fin);
    bokeh.uniforms.maxblur.value = lerp(0.004, 0.009, fin);
  }

  /* --- DOM --- */
  _c.copy(FG_DARK).lerp(FG_LIGHT, s);
  root.style.setProperty('--fg', `#${_c.getHexString()}`);
  root.style.setProperty('--fg-soft', `rgba(${(_c.r * 255) | 0},${(_c.g * 255) | 0},${(_c.b * 255) | 0},0.72)`);
  root.style.setProperty('--shadow', s > 0.5 ? '0 2px 24px rgba(0,0,0,0.55)' : 'none');
  document.body.style.background = `#${_c.copy(bgDisplay).convertLinearToSRGB().getHexString()}`;

  const heroIntro = eramp(intro, 0.55, 0.85);
  captions.forEach((c, idx) => {
    const [a, b, d, e] = c.r;
    let o = p < b ? ramp(p, a, b) : p <= d ? 1 : 1 - ramp(p, d, e);
    o = ease(o) * (idx === 0 ? heroIntro : 1);
    const dir = p < b && idx !== 0 ? 1 : -1;
    c.el.style.opacity = o;
    c.el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
    c.el.style.transform = `translateY(${(1 - o) * 40 * (idx === 0 && p < 0.01 ? 1 : dir)}px)`;
  });
  const ui = eramp(intro, 0.3, 0.7);
  topbar.style.opacity = Math.max(ui, s);
  chaptersEl.style.opacity = Math.max(ui, s);
  badges.style.opacity = heroIntro * (1 - ramp(p, 0.015, 0.06));
  scrollHint.style.opacity = (1 - ramp(p, 0.005, 0.03)) * eramp(intro, 0.8, 1);
  progressBar.style.width = `${p * 100}%`;
  scrim.style.opacity = s * 0.9 * (1 - fin);
  vignette.style.opacity = s * (0.35 + 0.5 * fin);

  const headO = eramp(p, 0.76, 0.8);
  gemHead.style.opacity = headO;
  gemHead.style.transform = `translateX(-50%) translateY(${(1 - headO) * -20}px)`;
  specItems().forEach((el, i) => {
    const k = i % 4, side = i < 4 ? -1 : 1;
    const st = 0.78 + k * 0.022 + (side > 0 ? 0.011 : 0);
    const o = eramp(p, st, st + 0.03);
    el.style.opacity = o;
    el.style.transform = `translateX(${(1 - o) * 30 * side}px)`;
  });
  const barO = eramp(p, 0.86, 0.9);
  stoneBar.style.opacity = barO;
  stoneBar.classList.toggle('live', barO > 0.5);
  dragHint.style.opacity = eramp(p, 0.84, 0.88) * 0.9;
  gemInteractive = p > 0.8;
  canvas.classList.toggle('grab', gemInteractive && !dragging);

  let active = 0;
  CHAPTERS.forEach(([, cp], i) => { if (p >= cp - 0.04) active = i; });
  chapterBtns.forEach((b, i) => b.classList.toggle('active', i === active));
}

// The storefront overlay is drawn last, straight to the screen (untouched by tone mapping so the
// photograph and the white page stay true). The 3D showroom is only rendered once we cross the threshold.
function renderFrame() {
  const a = ovMat.uniforms.uAlpha.value;
  if (a < 0.999) composer.render();
  if (a > 0.001) {
    renderer.autoClear = a >= 0.999;
    renderer.render(ovScene, ovCam);
    renderer.autoClear = true;
  }
}
renderer.setAnimationLoop(() => { update(); renderFrame(); });

document.querySelector('.loader').classList.add('done');
introStart = performance.now() + 700;

// Debug: ?debug exposes __go(progress) to render any scroll position synchronously.
if (new URLSearchParams(location.search).has('debug')) {
  window.__go = (target) => {
    pTarget = target; p = target; introStart = -1e9;
    update(); renderFrame();
    return [target, camera.position.toArray().map((v) => +v.toFixed(2))];
  };
  window.__dbg = { THREE, scene, bloom, bokeh, composer, renderer, camera, mat, gemMat, assocMat, associate };
}
