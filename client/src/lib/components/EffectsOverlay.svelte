<script lang="ts">
  import { onMount } from 'svelte';
  import { onWsEvent } from '$lib/ws';

  let { channelId }: { channelId: string } = $props();

  let canvas: HTMLCanvasElement;
  let particles: Particle[] = [];
  let animationId: number | null = null;

  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    life: number;
    maxLife: number;
    shape: 'rect' | 'circle' | 'heart' | 'text';
    text?: string;
    rotation: number;
    rotationSpeed: number;
    gravity: number;
    opacity: number;
  }

  const COLORS = [
    '#ff6b6b',
    '#ffd93d',
    '#6bcb77',
    '#4d96ff',
    '#ff6eb4',
    '#a855f7',
    '#f97316',
    '#06b6d4',
  ];

  function isMobile(): boolean {
    return window.innerWidth <= 768;
  }

  function spawnConfetti(w: number, h: number) {
    const count = isMobile() ? 60 : 120;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: -10 - Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 3 + 2,
        size: Math.random() * 8 + 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 0,
        maxLife: 180 + Math.random() * 60,
        shape: 'rect',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
        gravity: 0.05,
        opacity: 1,
      });
    }
  }

  function spawnFireworks(w: number, h: number) {
    const cx = w * (0.3 + Math.random() * 0.4);
    const cy = h * (0.2 + Math.random() * 0.3);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const count = isMobile() ? 30 : 60;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / 60;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 4 + 2,
        color,
        life: 0,
        maxLife: 80 + Math.random() * 40,
        shape: 'circle',
        rotation: 0,
        rotationSpeed: 0,
        gravity: 0.06,
        opacity: 1,
      });
    }
    // Second burst
    setTimeout(() => {
      const cx2 = w * (0.2 + Math.random() * 0.6);
      const cy2 = h * (0.15 + Math.random() * 0.35);
      const color2 = COLORS[Math.floor(Math.random() * COLORS.length)];
      const count2 = isMobile() ? 25 : 50;
      for (let i = 0; i < count2; i++) {
        const angle = (Math.PI * 2 * i) / 50;
        const speed = 2 + Math.random() * 3;
        particles.push({
          x: cx2,
          y: cy2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: Math.random() * 3 + 2,
          color: color2,
          life: 0,
          maxLife: 70 + Math.random() * 30,
          shape: 'circle',
          rotation: 0,
          rotationSpeed: 0,
          gravity: 0.06,
          opacity: 1,
        });
      }
      ensureAnimation();
    }, 300);
  }

  function spawnHearts(w: number, h: number) {
    const count = isMobile() ? 15 : 30;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: h + 10 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 2,
        vy: -(Math.random() * 3 + 2),
        size: Math.random() * 14 + 8,
        color: ['#ff6b6b', '#ff6eb4', '#f43f5e', '#e11d48'][Math.floor(Math.random() * 4)],
        life: 0,
        maxLife: 150 + Math.random() * 60,
        shape: 'heart',
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 0.05,
        gravity: 0,
        opacity: 1,
      });
    }
  }

  function spawnSnow(w: number, h: number) {
    const count = isMobile() ? 40 : 80;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: -10 - Math.random() * h * 0.5,
        vx: (Math.random() - 0.5) * 1,
        vy: Math.random() * 1.5 + 0.5,
        size: Math.random() * 5 + 2,
        color: '#ffffff',
        life: 0,
        maxLife: 240 + Math.random() * 60,
        shape: 'circle',
        rotation: 0,
        rotationSpeed: 0,
        gravity: 0,
        opacity: 0.8 + Math.random() * 0.2,
      });
    }
  }

  function spawnMoney(w: number, h: number) {
    const count = isMobile() ? 30 : 60;
    const symbols = ['💵', '💰', '💸', '🤑', '💲'];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: -10 - Math.random() * h * 0.4,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 2.5 + 1.5,
        size: Math.random() * 10 + 16,
        color: '#2dd4a8',
        life: 0,
        maxLife: 200 + Math.random() * 60,
        shape: 'text',
        text: symbols[Math.floor(Math.random() * symbols.length)],
        rotation: (Math.random() - 0.5) * 0.4,
        rotationSpeed: (Math.random() - 0.5) * 0.08,
        gravity: 0.03,
        opacity: 1,
      });
    }
  }

  function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.4);
    ctx.bezierCurveTo(-s, -s * 1.2, -s * 1.4, s * 0.2, 0, s);
    ctx.bezierCurveTo(s * 1.4, s * 0.2, s, -s * 1.2, 0, -s * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  function animate() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.rotationSpeed;
      p.vx *= 0.99;

      const lifeRatio = p.life / p.maxLife;
      p.opacity = lifeRatio > 0.7 ? 1 - (lifeRatio - 0.7) / 0.3 : p.opacity;

      if (p.life >= p.maxLife) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'heart') {
        drawHeart(ctx, 0, 0, p.size);
      } else if (p.shape === 'text' && p.text) {
        ctx.font = `${p.size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, 0, 0);
      }

      ctx.restore();
    }

    if (particles.length > 0) {
      animationId = requestAnimationFrame(animate);
    } else {
      animationId = null;
    }
  }

  function ensureAnimation() {
    if (animationId === null && particles.length > 0) {
      animationId = requestAnimationFrame(animate);
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }

  function playEffect(effect: string) {
    if (!canvas) return;
    resizeCanvas();
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    switch (effect) {
      case 'confetti':
        spawnConfetti(w, h);
        break;
      case 'fireworks':
        spawnFireworks(w, h);
        break;
      case 'hearts':
        spawnHearts(w, h);
        break;
      case 'snow':
        spawnSnow(w, h);
        break;
      case 'money':
        spawnMoney(w, h);
        break;
    }
    ensureAnimation();
  }

  onMount(() => {
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

    const unsub = onWsEvent((event) => {
      if (event.type === 'effect:play' && event.channelId === channelId) {
        playEffect(event.effect);
      }
    });

    return () => {
      unsub();
      resizeObserver.disconnect();
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  });
</script>

<canvas class="effects-overlay" bind:this={canvas}></canvas>

<style>
  .effects-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
  }
</style>
