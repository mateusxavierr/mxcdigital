/**
 * Netuno — WebGL (Three.js)
 * Posição do canvas no hero: fixa (neptune-scroll.js, principalmente mobile).
 * Animação: rotação contínua no eixo Y do modelo (eixo "natural" do GLB), sem mover o wrapper.
 *
 * PERF (v2):
 *  - Desktop low-tier (hardwareConcurrency ≤ 8, e.g. M1 Air):
 *      · DPR cap 1.5 em vez de 2  → −44% de fill rate no WebGL (2600px → 1950px em Retina)
 *      · antialias desligado       → sem overhead MSAA por frame
 *      · LinearToneMapping         → mais leve que ACESFilmic
 *      · render a 30fps (skip par) → metade do trabalho da GPU; rotação acumula em 60fps
 *      · anisotropy 2 em vez de 4  → amostragem de textura mais rápida
 *  - offsetWidth/Height lidos no loop animate somente quando o tamanho muda (sem reflow).
 *  - heroVisible bloqueia render em TODOS os devices (não só mobile).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/loaders/GLTFLoader.js';

function isMobileLayout() {
  return window.matchMedia('(max-width: 767.98px)').matches;
}

const canvas = document.getElementById('neptune-canvas');
const wrapper = document.getElementById('neptune-canvas-wrapper');

if (!canvas || !wrapper) {
  console.warn('[Netuno 3D] canvas ou wrapper não encontrado.');
} else {
  const mobile = isMobileLayout();
  const cores  = navigator.hardwareConcurrency || 4;
  const dpr    = window.devicePixelRatio || 1;

  /* Mobile low-tier: mesma heurística do scroll.js */
  const lowTierAtInit = mobile && (cores <= 4 || dpr >= 3);

  /*
   * Desktop low-tier: hardwareConcurrency ≤ 8 captura M1 Air (8 cores E+P),
   * mas não M1 Pro (10), M2 Pro (12), M4 Pro (14+), etc.
   */
  const desktopLowTier = !mobile && cores <= 8;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    /* antialias só em desktop de alto tier — MSAA adiciona ~30-50% de fill overhead */
    antialias: !mobile && !desktopLowTier,
    powerPreference: 'high-performance',
  });

  /*
   * DPR cap:
   *   mobile / desktop low-tier → 1.5  (M1 Retina: 2600×2600 → 1950×1950, −44% fill)
   *   desktop normal            → 2    (como antes)
   */
  const effectiveDpr = (mobile || desktopLowTier)
    ? Math.min(dpr, 1.5)
    : Math.min(dpr, 2);
  renderer.setPixelRatio(effectiveDpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* Tone mapping: ACES é pesado por pixel; Linear suficiente em chips menos potentes */
  if ((mobile && lowTierAtInit) || desktopLowTier) {
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = desktopLowTier ? 1.18 : 1.26;
  } else {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = mobile ? 1.32 : 1.1;
  }

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  camera.position.set(0, 0, 3.8);

  const scene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0x5566aa, mobile ? 1.28 : 1.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff3e0, mobile ? 1.38 : 1.4);
  sun.position.set(4, 3, 5);
  scene.add(sun);

  const cyanFill = new THREE.PointLight(0x03f0fc, mobile ? 0.48 : 0.5, 20);
  cyanFill.position.set(-3, -1, 2);
  scene.add(cyanFill);

  const rimLight = new THREE.DirectionalLight(0x1a3a8a, 0.4);
  rimLight.position.set(-4, -2, -3);
  scene.add(rimLight);

  /*
   * Dimensões do wrapper: _lastW/_lastH rastreiam o último tamanho visto pelo renderer.
   *
   * Por que ler offsetWidth no loop animate e não só no evento resize?
   * O scroll.js define width/height do wrapper via JS (double-rAF após load), DEPOIS de o
   * módulo Three.js já ter rodado. Sem checar a cada frame, o renderer ficaria com o tamanho
   * errado (dimensão padrão do canvas: 300×150) até o próximo resize do browser.
   *
   * Isso é seguro de performance: com o scroll.js agora usando transform em vez de
   * width/height, não há mais escrita de propriedades de layout a cada scroll — portanto
   * ler offsetWidth no rAF usa o valor cacheado do browser sem forçar reflow.
   */
  let _lastW = 0;
  let _lastH = 0;

  function resize() {
    const w = wrapper.offsetWidth;
    const h = wrapper.offsetHeight;
    if (w > 0 && h > 0) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      _lastW = w;
      _lastH = h;
    }
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });

  const mq = window.matchMedia('(max-width: 767.98px)');
  function syncDpr() {
    const mob = isMobileLayout();
    /* Mantém o DPR cap correto ao alternar mobile ↔ desktop */
    renderer.setPixelRatio(
      (mob || desktopLowTier)
        ? Math.min(window.devicePixelRatio || 1, 1.5)
        : Math.min(window.devicePixelRatio || 1, 2)
    );
    resize();
  }
  if (mq.addEventListener) {
    mq.addEventListener('change', syncDpr);
  } else if (mq.addListener) {
    mq.addListener(syncDpr);
  }

  let neptuneMesh = null;
  let baseScale = 1;

  /** Só mobile: escala extra do mesh até o limbo colar no arco ciano (sem desktop). */
  function globeFillMul() {
    return isMobileLayout() ? 1.32 : 1;
  }

  /*
   * heroVisible: para render quando hero sai da tela — vale para TODOS os devices.
   * Anteriormente só bloqueava mobile; no desktop o WebGL continuava rodando a 60fps
   * mesmo quando o usuário estava em seções completamente diferentes do site.
   */
  const heroEl = document.getElementById('hero');
  let heroVisible = true;
  if (heroEl && typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        heroVisible = e ? e.isIntersecting : true;
      },
      { root: null, threshold: 0, rootMargin: '80px' }
    );
    io.observe(heroEl);
  }

  if (location.protocol === 'file:') {
    console.warn(
      '[Netuno 3D] file:// não carrega GLB. Use npm run dev e http://localhost:5173'
    );
  } else {
    const loader = new GLTFLoader();
    loader.load(
      'assets/neptune.glb',
      (gltf) => {
        const group = gltf.scene;
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.0001);

        group.position.sub(center);

        baseScale = 2.2 / maxDim;
        group.scale.setScalar(baseScale * globeFillMul());

        const mobNow = isMobileLayout();
        group.traverse((obj) => {
          if (obj.isMesh) {
            obj.frustumCulled = true;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if (m && m.map) {
                /* anisotropy: 4 em desktop normal, 2 em low-tier, 1 em mobile */
                m.map.anisotropy = mobNow ? 1 : (desktopLowTier ? 2 : 4);
                m.map.minFilter = THREE.LinearMipmapLinearFilter;
              }
            });
          }
        });

        neptuneMesh = group;
        scene.add(group);
      },
      undefined,
      (error) => {
        console.error('[Netuno 3D] erro ao carregar GLB:', error);
      }
    );
  }

  let frameIndex = 0;

  /** Como na versão inline: boost linear + decay por frame (só desktop usa vel > 0). */
  const SCROLL_ROT_BOOST_MUL = 0.005;
  const SCROLL_VEL_DECAY = 0.84;
  const SCROLL_VEL_EPS = 0.0005;

  function animate() {
    requestAnimationFrame(animate);

    const mob = isMobileLayout();
    const tierLow =
      mob &&
      ((navigator.hardwareConcurrency || 4) <= 4 ||
        (window.devicePixelRatio || 1) >= 3);

    /* Detecta mudança de tamanho do wrapper (e.g. scroll.js setando dimensões pós-load) */
    const w = wrapper.offsetWidth;
    const h = wrapper.offsetHeight;
    if ((w !== _lastW || h !== _lastH) && w > 0 && h > 0) {
      _lastW = w;
      _lastH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    if (neptuneMesh) {
      /*
       * Rotação no eixo Y (+ X fixo). Acumula em TODOS os frames (incluindo os pulados),
       * para que a velocidade de rotação seja independente do fps de render.
       */
      let rotMul = 1;
      if (mob && tierLow) {
        rotMul = 0.72;
      }
      const baseRot = 0.0022 * rotMul;

      let rotSpeed = baseRot;
      if (!mob) {
        const vel = window._neptuneScrollVelocity || 0;
        rotSpeed += vel * SCROLL_ROT_BOOST_MUL;

        if (window._neptuneScrollVelocity > 0) {
          window._neptuneScrollVelocity *= SCROLL_VEL_DECAY;
          if (window._neptuneScrollVelocity < SCROLL_VEL_EPS) {
            window._neptuneScrollVelocity = 0;
          }
        }
      }

      neptuneMesh.rotation.y += rotSpeed;
      neptuneMesh.rotation.x = 0.08;
      neptuneMesh.scale.setScalar(baseScale * globeFillMul());
    }

    /* Não renderiza quando o hero não está visível — vale para mobile E desktop */
    if (!heroVisible) {
      return;
    }

    frameIndex += 1;

    /* Mobile low-tier: renderiza metade dos frames (30fps efectivo) */
    if (tierLow && mob && frameIndex % 2 !== 0) {
      return;
    }

    /* Desktop low-tier: idem — 30fps de render com 60fps de rotação acumulada */
    if (desktopLowTier && frameIndex % 2 !== 0) {
      return;
    }

    renderer.render(scene, camera);
  }

  animate();
}
