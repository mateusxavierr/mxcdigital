/**
 * Netuno — canvas + scroll no hero.
 *
 * Mobile: lua/anel alinhados ao canvas; geometria travada após 1.º layout; sem animação de
 * scroll no wrapper (ver mobile-layout + cluster).
 * Desktop: Netuno v3 — cresce até cobrir o viewport (0→50% do hero), retrai ao tamanho
 * inicial (50→100%); fixed durante a animação, absolute após maxScroll. Fades do anel e texto
 * como no layout original.
 *
 * PERF (v4): A animação de scroll usa transform: translate3d() scale() em vez de
 * width/height/left/top, eliminando layout reflow e realocação do framebuffer WebGL a cada
 * frame. Apenas o compositor GPU é acionado durante o scroll — sem paint, sem reflow.
 */
(function () {
  'use strict';

  var mqMobile = window.matchMedia('(max-width: 767.98px)');

  function isMobileLayout() {
    return mqMobile.matches;
  }

  var wrapper = document.getElementById('neptune-canvas-wrapper');
  var cluster = document.getElementById('neptune-hero-cluster');
  var heroOuter = document.getElementById('hero');
  var heroSticky = document.getElementById('hero-sticky');
  var heroMoon = document.getElementById('hero-moon');
  var moonRing = document.querySelector('.hero-moon-ring');
  var moonApex = document.querySelector('.hero-moon-apex');
  var horizonSweep = document.getElementById('horizon-sweep');
  var heroContent = document.getElementById('hero-content');
  var sitePillHeader = document.getElementById('site-pill-header');

  if (!wrapper || !heroOuter || !heroSticky) {
    console.warn('[Netuno scroll] Elemento essencial não encontrado.');
    return;
  }

  window._neptuneScrollVelocity = 0;
  var _lastScrollY = 0;
  var SCROLL_VEL_BLEND = 0.22;

  var moonCX = 0;
  var moonCY = 0;
  var moonInitSize = 0;
  var coverSize = 0;
  var vpW = 0;
  var vpH = 0;
  var maxScroll = 0;

  /* PERF: base layout aplicado uma só vez (no init/resize), não a cada frame de scroll. */
  var _fixedBaseApplied = false;
  var _rafScrollPending = false;

  /** Mobile: valores do 1.º layout; ignorar resize que só muda altura. */
  var mobileGeoLocked = false;
  var lockVpW = 0;
  var lockMoonCX = 0;
  var lockMoonCY = 0;
  var lockMoonInitSize = 0;

  window.__neptuneLowTierMobile = false;

  function computeTier() {
    if (!isMobileLayout()) {
      window.__neptuneLowTierMobile = false;
      return;
    }
    var cores = navigator.hardwareConcurrency || 4;
    var dpr = window.devicePixelRatio || 1;
    window.__neptuneLowTierMobile = cores <= 4 || dpr >= 3;
  }

  function computeDimensions() {
    vpW = window.innerWidth;
    vpH = window.innerHeight;

    if (isMobileLayout() && mobileGeoLocked && Math.abs(vpW - lockVpW) < 1.5) {
      moonCX = lockMoonCX;
      moonCY = lockMoonCY;
      moonInitSize = lockMoonInitSize;
      maxScroll = heroOuter.offsetHeight - vpH;
      computeTier();
      return;
    }

    var moonDiam = Math.min(1000, vpW * 1.3);
    var moonRadius = moonDiam / 2;

    moonCX = vpW / 2;
    moonCY = 1.45 * vpH - moonRadius;

    moonInitSize = moonDiam * 1.297;
    coverSize = Math.sqrt(vpW * vpW + vpH * vpH) * 1.08;

    maxScroll = heroOuter.offsetHeight - vpH;

    if (isMobileLayout()) {
      mobileGeoLocked = true;
      lockVpW = vpW;
      lockMoonCX = moonCX;
      lockMoonCY = moonCY;
      lockMoonInitSize = moonInitSize;
    } else {
      mobileGeoLocked = false;
    }

    computeTier();
    /* Invalidar base fixa para que resize re-aplique posição/tamanho corretos. */
    _fixedBaseApplied = false;
  }

  function syncMobileArcToPlanet() {
    if (!isMobileLayout() || !cluster || !heroMoon || !moonRing) {
      return;
    }
    var sz = moonInitSize;
    var L = moonCX - sz * 0.5;
    var T = moonCY - sz * 0.5;
    function pinArcLayer(el) {
      el.style.setProperty('left', L + 'px', 'important');
      el.style.setProperty('top', T + 'px', 'important');
      el.style.setProperty('width', sz + 'px', 'important');
      el.style.setProperty('height', sz + 'px', 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('transform', 'none', 'important');
    }
    pinArcLayer(heroMoon);
    pinArcLayer(moonRing);
  }

  function clearMobileArcInline() {
    if (!heroMoon || !moonRing) {
      return;
    }
    var props = [
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'transform',
    ];
    for (var i = 0; i < props.length; i++) {
      heroMoon.style.removeProperty(props[i]);
      moonRing.style.removeProperty(props[i]);
    }
  }

  function applyWrapperLayout() {
    wrapper.style.position = 'absolute';
    wrapper.style.left = moonCX - moonInitSize / 2 + 'px';
    wrapper.style.top = moonCY - moonInitSize / 2 + 'px';
    wrapper.style.width = moonInitSize + 'px';
    wrapper.style.height = moonInitSize + 'px';
    wrapper.style.right = 'auto';
    wrapper.style.bottom = 'auto';
    wrapper.style.opacity = '1';

    if (cluster && isMobileLayout()) {
      wrapper.style.transform = 'none';
      wrapper.style.willChange = 'auto';
      wrapper.style.transformOrigin = '';
      syncMobileArcToPlanet();
    }
  }

  function resetWrapperTransformDesktop() {
    wrapper.style.transform = 'none';
    wrapper.style.willChange = 'auto';
    wrapper.style.transformOrigin = '';
    if (cluster) {
      cluster.style.transform = 'none';
      cluster.style.willChange = 'auto';
      cluster.style.transformOrigin = '';
    }
  }

  function setHeroDecorFullOpacity() {
    if (moonRing) moonRing.style.opacity = '1';
    if (moonApex) moonApex.style.opacity = '1';
    if (horizonSweep) horizonSweep.style.opacity = '1';
    if (heroContent) heroContent.style.opacity = '1';
    if (sitePillHeader) sitePillHeader.style.opacity = '1';
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * PERF: Aplica posição/tamanho base do wrapper UMA VEZ (no init/resize).
   * Durante o scroll só o transform muda — zero layout reflow, zero realocação WebGL.
   */
  function applyFixedBase() {
    if (_fixedBaseApplied) return;
    /* Reset cluster herdado de mobile */
    if (cluster) {
      cluster.style.transform = 'none';
      cluster.style.willChange = 'auto';
      cluster.style.transformOrigin = '';
    }
    wrapper.style.position = 'fixed';
    wrapper.style.width = moonInitSize + 'px';
    wrapper.style.height = moonInitSize + 'px';
    wrapper.style.left = (moonCX - moonInitSize / 2) + 'px';
    wrapper.style.top = (moonCY - moonInitSize / 2) + 'px';
    wrapper.style.right = 'auto';
    wrapper.style.bottom = 'auto';
    wrapper.style.opacity = '1';
    wrapper.style.willChange = 'transform';
    wrapper.style.transformOrigin = 'center';
    _fixedBaseApplied = true;
  }

  /** Desktop: Netuno v3 (cresce → retrai; centro move ao centro da viewport no pico).
   *  PERF v4: usa transform: translate3d()+scale() — compositor puro, sem reflow/paint. */
  function updateDesktopNeptune(scrollY) {
    if (scrollY >= maxScroll) {
      /* Fim da seção hero: volta para position:absolute sem transform */
      _fixedBaseApplied = false;
      if (cluster) {
        cluster.style.transform = 'none';
        cluster.style.willChange = 'auto';
        cluster.style.transformOrigin = '';
      }
      wrapper.style.position = 'absolute';
      wrapper.style.transform = 'none';
      wrapper.style.willChange = 'auto';
      wrapper.style.transformOrigin = '';
      wrapper.style.width = moonInitSize + 'px';
      wrapper.style.height = moonInitSize + 'px';
      wrapper.style.left = (moonCX - moonInitSize / 2) + 'px';
      wrapper.style.top = (moonCY - moonInitSize / 2) + 'px';
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
      wrapper.style.opacity = '1';
      setHeroDecorFullOpacity();
      return;
    }

    /* Garante que a base fixa (layout) está aplicada — só executa na 1.ª vez ou pós-resize */
    applyFixedBase();

    var p = maxScroll > 0 ? clamp(scrollY / maxScroll, 0, 1) : 0;
    var half = 0.5;
    var scaleRatio = coverSize / moonInitSize;
    var scaleFactor, tx, ty;

    if (p <= half) {
      var tGrow = easeInOut(p / half);
      scaleFactor = lerp(1, scaleRatio, tGrow);
      tx = lerp(0, vpW / 2 - moonCX, tGrow);
      ty = lerp(0, vpH / 2 - moonCY, tGrow);
    } else {
      var tShrink = easeInOut((p - half) / half);
      scaleFactor = lerp(scaleRatio, 1, tShrink);
      tx = lerp(vpW / 2 - moonCX, 0, tShrink);
      ty = lerp(vpH / 2 - moonCY, 0, tShrink);
    }

    /* Apenas transform muda: 0 reflow, 0 paint, 0 realocação WebGL */
    wrapper.style.transform =
      'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)' +
      ' scale(' + scaleFactor.toFixed(5) + ')';

    var ringFade =
      p <= half ? 1 - easeInOut(p / half) : easeInOut((p - half) / half);

    if (moonRing) moonRing.style.opacity = ringFade.toFixed(3);
    if (moonApex) moonApex.style.opacity = ringFade.toFixed(3);
    if (horizonSweep) horizonSweep.style.opacity = ringFade.toFixed(3);

    var textFadeOutBy = 0.22;
    var textBackFrom = 0.72;
    var textOp;
    if (p <= half) {
      textOp = p >= textFadeOutBy ? 0 : 1 - easeInOut(p / textFadeOutBy);
    } else if (p < textBackFrom) {
      textOp = 0;
    } else {
      textOp = easeInOut((p - textBackFrom) / (1 - textBackFrom));
    }
    if (heroContent) heroContent.style.opacity = textOp.toFixed(3);
    if (sitePillHeader) sitePillHeader.style.opacity = textOp.toFixed(3);
  }

  function update() {
    if (isMobileLayout()) {
      applyWrapperLayout();
      /* Garantir que o cluster desktop está limpo ao entrar em mobile */
      if (cluster) {
        cluster.style.transform = 'none';
        cluster.style.willChange = 'auto';
        cluster.style.transformOrigin = '';
      }
      setHeroDecorFullOpacity();
      return;
    }

    clearMobileArcInline();
    updateDesktopNeptune(window.scrollY);
  }

  window.addEventListener(
    'scroll',
    function () {
      if (isMobileLayout()) {
        return;
      }
      /* Calcula velocidade de scroll imediatamente (para interpolação de rotação do Three.js) */
      var cy = window.scrollY;
      var rawDelta = Math.abs(cy - _lastScrollY);
      var v = window._neptuneScrollVelocity || 0;
      window._neptuneScrollVelocity =
        v * (1 - SCROLL_VEL_BLEND) + rawDelta * SCROLL_VEL_BLEND;
      _lastScrollY = cy;
      /* PERF: throttle via rAF — garante no máximo 1 update por frame de animação */
      if (!_rafScrollPending) {
        _rafScrollPending = true;
        requestAnimationFrame(function () {
          _rafScrollPending = false;
          update();
        });
      }
    },
    { passive: true }
  );

  window.addEventListener(
    'resize',
    function () {
      computeDimensions();
      update();
    },
    { passive: true }
  );

  function onMqChange() {
    if (!mqMobile.matches) {
      mobileGeoLocked = false;
    }
    computeDimensions();
    update();
    window.dispatchEvent(new Event('resize'));
  }
  if (mqMobile.addEventListener) {
    mqMobile.addEventListener('change', onMqChange);
  } else if (mqMobile.addListener) {
    mqMobile.addListener(onMqChange);
  }

  function init() {
    computeDimensions();
    update();
  }

  if (document.readyState === 'complete') {
    requestAnimationFrame(function () {
      requestAnimationFrame(init);
    });
  } else {
    window.addEventListener('load', function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(init);
      });
    });
  }
})();
