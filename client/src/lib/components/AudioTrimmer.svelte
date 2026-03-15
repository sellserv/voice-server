<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { encodeWavFromBuffer } from '$lib/audioEncoder';
  import Icon from './Icon.svelte';

  let {
    file,
    maxDuration = 7,
    onconfirm,
    oncancel,
  }: {
    file: File;
    maxDuration?: number;
    onconfirm: (blob: Blob, duration: number) => void;
    oncancel: () => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let audioBuffer = $state<AudioBuffer | null>(null);
  let loading = $state(true);
  let error = $state('');

  let regionStart = $state(0);
  let regionEnd = $state(0);
  let playing = $state(false);
  let loop = $state(true);
  let playbackPos = $state(-1);

  let sourceNode: AudioBufferSourceNode | null = null;
  let audioCtx: AudioContext | null = null;
  let animFrame = 0;
  let playStartWall = 0;
  let playStartOffset = 0;

  let dragging = $state<'start' | 'end' | 'region' | null>(null);
  let dragStartX = 0;
  let dragStartRegionStart = 0;
  let dragStartRegionEnd = 0;

  let canvasWidth = $state(600);
  const CANVAS_HEIGHT = 160;

  // Pre-computed peaks for fast rendering
  let peaks = $state<{ min: number; max: number }[]>([]);

  function computePeaks(buf: AudioBuffer, width: number) {
    console.log(`[Trimmer] Computing peaks for buffer: ${buf.duration}s, length: ${buf.length}, width: ${width}`);
    const data = buf.getChannelData(0);
    const result = [];
    const step = data.length / width;
    let maxOverall = 0;

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      const start = Math.floor(i * step);
      const end = Math.floor((i + 1) * step);
      
      // For very short buffers, ensure we check at least one sample
      if (start === end && start < data.length) {
        const v = data[start];
        min = v; max = v;
      } else {
        for (let j = start; j < end; j++) {
          const v = data[j];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      
      if (min > max) { min = 0; max = 0; }
      result.push({ min, max });
      maxOverall = Math.max(maxOverall, Math.abs(min), Math.abs(max));
    }

    // Boost the visual amplitude significantly for display
    const targetMax = 0.8;
    if (maxOverall > 0) {
      const factor = targetMax / maxOverall;
      for (const p of result) {
        p.min *= factor;
        p.max *= factor;
      }
    }
    
    console.log(`[Trimmer] Peaks computed. Max amplitude observed: ${maxOverall.toFixed(4)}`);
    return result;
  }

  // Handle file loading and decoding
  $effect(() => {
    let active = true;
    loading = true;
    error = '';
    
    console.log(`[Trimmer] Loading file: ${file.name} (${file.size} bytes)`);
    
    file.arrayBuffer().then(async (ab) => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(ab);
        if (!active) {
          ctx.close();
          return;
        }
        
        audioBuffer = decoded;
        audioCtx = ctx;
        peaks = computePeaks(decoded, 1000); 

        // Set initial selection
        regionStart = 0;
        regionEnd = Math.min(decoded.duration, maxDuration);
        loading = false;
        console.log(`[Trimmer] Ready. Selection: ${regionStart}s to ${regionEnd}s`);
      } catch (e) {
        if (active) {
          console.error('[Trimmer] Decode Error:', e);
          error = 'Could not decode audio file';
          loading = false;
        }
      }
    });

    return () => {
      active = false;
      stopPlayback();
      if (audioCtx) audioCtx.close();
    };
  });

  function updatePlaybackPos() {
    if (!playing || !audioCtx) {
      playbackPos = -1;
      return;
    }
    const elapsed = audioCtx.currentTime - playStartWall;
    playbackPos = playStartOffset + elapsed;
    
    if (playbackPos >= regionEnd) {
      if (loop) {
        startPlayback();
      } else {
        stopPlayback();
      }
      return;
    }
    animFrame = requestAnimationFrame(updatePlaybackPos);
  }

  // Drawing logic
  $effect(() => {
    if (!canvas || !audioBuffer || peaks.length === 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    const w = canvasWidth;
    const h = CANVAS_HEIGHT;
    
    // Set actual canvas size
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // High contrast colors
    const colorBg = '#000000';
    const colorWaveformBase = 'rgba(255, 255, 255, 0.2)';
    const colorWaveformSelected = '#a78bfa'; // Bright purple
    const colorHandle = '#ffffff';
    const colorPlayhead = '#ef4444'; // Bright red

    // 1. Clear & Background
    ctx.fillStyle = colorBg;
    ctx.fillRect(0, 0, w, h);

    const dur = audioBuffer.duration;
    const selStartPx = (regionStart / dur) * w;
    const selEndPx = (regionEnd / dur) * w;

    // 2. Draw Center Line (to verify rendering is happening)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, h/2);
    ctx.lineTo(w, h/2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Draw Waveform
    const midY = h / 2;
    const barWidth = w / peaks.length;
    
    peaks.forEach((p, i) => {
      const x = i * barWidth;
      const inRegion = x >= selStartPx && x <= selEndPx;
      
      ctx.fillStyle = inRegion ? colorWaveformSelected : colorWaveformBase;
      
      const top = midY + (p.min * (h / 2.2));
      const bottom = midY + (p.max * (h / 2.2));
      const barH = Math.max(1, bottom - top);
      
      ctx.fillRect(x, top, Math.max(1, barWidth - 0.5), barH);
    });

    // 4. Overlay for non-selected areas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, selStartPx, h);
    ctx.fillRect(selEndPx, 0, w - selEndPx, h);

    // 5. Handles & Borders
    ctx.fillStyle = colorWaveformSelected;
    ctx.fillRect(selStartPx - 1, 0, 2, h);
    ctx.fillRect(selEndPx - 1, 0, 2, h);

    // Handle Dots
    ctx.fillStyle = colorHandle;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    
    // Start Handle
    ctx.beginPath();
    ctx.arc(selStartPx, 20, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorWaveformSelected;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // End Handle
    ctx.beginPath();
    ctx.arc(selEndPx, h - 20, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.shadowBlur = 0;

    // 6. Playhead
    if (playbackPos >= 0) {
      const ppx = (playbackPos / dur) * w;
      ctx.strokeStyle = colorPlayhead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ppx, 0);
      ctx.lineTo(ppx, h);
      ctx.stroke();
      
      ctx.fillStyle = colorPlayhead;
      ctx.beginPath();
      ctx.moveTo(ppx - 6, 0);
      ctx.lineTo(ppx + 6, 0);
      ctx.lineTo(ppx, 10);
      ctx.fill();
    }
  });

  $effect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          canvasWidth = entry.contentRect.width;
        }
      }
    });
    observer.observe(canvas.parentElement!);
    return () => observer.disconnect();
  });

  function timeToX(t: number): number {
    if (!audioBuffer) return 0;
    return (t / audioBuffer.duration) * canvasWidth;
  }

  function xToTime(x: number): number {
    if (!audioBuffer) return 0;
    return Math.max(0, Math.min(audioBuffer.duration, (x / canvasWidth) * audioBuffer.duration));
  }

  function onPointerDown(e: PointerEvent) {
    if (!audioBuffer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const startPx = timeToX(regionStart);
    const endPx = timeToX(regionEnd);
    const threshold = 40; // Generous hit area

    if (Math.abs(x - startPx) < threshold) {
      dragging = 'start';
    } else if (Math.abs(x - endPx) < threshold) {
      dragging = 'end';
    } else if (x > startPx && x < endPx) {
      dragging = 'region';
      dragStartX = x;
      dragStartRegionStart = regionStart;
      dragStartRegionEnd = regionEnd;
    } else {
      const clickedTime = xToTime(x);
      if (Math.abs(clickedTime - regionStart) < Math.abs(clickedTime - regionEnd)) {
        regionStart = clickedTime;
      } else {
        regionEnd = clickedTime;
      }
    }

    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || !audioBuffer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = xToTime(x);
    const dur = audioBuffer.duration;
    const minGap = 0.1;

    if (dragging === 'start') {
      regionStart = Math.max(0, Math.min(t, regionEnd - minGap));
      if (regionEnd - regionStart > maxDuration) regionEnd = regionStart + maxDuration;
    } else if (dragging === 'end') {
      regionEnd = Math.min(dur, Math.max(t, regionStart + minGap));
      if (regionEnd - regionStart > maxDuration) regionStart = regionEnd - maxDuration;
    } else if (dragging === 'region') {
      const dx = x - dragStartX;
      const dt = (dx / canvasWidth) * dur;
      const span = dragStartRegionEnd - dragStartRegionStart;
      let newStart = dragStartRegionStart + dt;
      let newEnd = dragStartRegionEnd + dt;
      if (newStart < 0) { newStart = 0; newEnd = span; }
      else if (newEnd > dur) { newEnd = dur; newStart = dur - span; }
      regionStart = newStart;
      regionEnd = newEnd;
    }
  }

  function onPointerUp() { dragging = null; }

  async function startPlayback() {
    if (!audioBuffer || !audioCtx) return;
    stopPlayback();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(audioCtx.destination);
    src.start(0, regionStart, Math.max(0.01, regionEnd - regionStart));
    sourceNode = src;
    playing = true;
    playStartWall = audioCtx.currentTime;
    playStartOffset = regionStart;
    src.onended = () => { if (!loop) { playing = false; playbackPos = -1; } };
    cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(updatePlaybackPos);
  }

  function stopPlayback() {
    if (sourceNode) { try { sourceNode.stop(); sourceNode.disconnect(); } catch {} sourceNode = null; }
    playing = false;
    playbackPos = -1;
    cancelAnimationFrame(animFrame);
  }

  function handleConfirm() {
    if (!audioBuffer) return;
    const blob = encodeWavFromBuffer(audioBuffer, regionStart, regionEnd);
    onconfirm(blob, regionEnd - regionStart);
  }
</script>

<div class="trimmer">
  <div class="trimmer-header">
    <div class="title-area">
      <Icon name="music" size={18} />
      <h3>Trim Sound</h3>
    </div>
    <div class="info-badge" class:limit={regionEnd - regionStart > maxDuration - 0.01}>
      {(regionEnd - regionStart).toFixed(2)}s / {maxDuration}s max
    </div>
  </div>

  {#if loading}
    <div class="trimmer-status">
      <div class="spinner"></div>
      <span>Decoding audio...</span>
    </div>
  {:else if error}
    <div class="trimmer-status error">
      <Icon name="x" size={24} />
      <span>{error}</span>
    </div>
  {:else}
    <div class="waveform-wrapper">
      <canvas
        bind:this={canvas}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
      ></canvas>
    </div>

    <div class="trimmer-toolbar">
      <button class="playback-btn" onclick={playing ? stopPlayback : startPlayback} title={playing ? 'Stop' : 'Play'}>
        <Icon name={playing ? 'x' : 'play'} size={20} />
      </button>
      
      <div class="time-inputs">
        <div class="input-field"><span>Start</span><strong>{regionStart.toFixed(2)}s</strong></div>
        <div class="input-field"><span>End</span><strong>{regionEnd.toFixed(2)}s</strong></div>
      </div>

      <div class="actions">
        <button class="btn-cancel" onclick={oncancel}>Cancel</button>
        <button class="btn-apply" onclick={handleConfirm}>Apply</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .trimmer {
    background: #0c0c16;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
    width: 100%;
  }

  .trimmer-header { display: flex; align-items: center; justify-content: space-between; }
  .title-area { display: flex; align-items: center; gap: 10px; color: white; }
  .title-area h3 { margin: 0; font-size: 0.95rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
  .info-badge { font-size: 0.75rem; font-weight: 700; color: #aaa; background: #161625; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); }
  .info-badge.limit { color: #f59e0b; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.2); }

  .waveform-wrapper {
    width: 100%; height: 160px; background: #000000;
    border-radius: 8px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.2);
    position: relative; box-shadow: inset 0 2px 10px rgba(0,0,0,0.8);
  }
  canvas { width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; }

  .trimmer-toolbar { display: flex; align-items: center; gap: 20px; }
  .playback-btn {
    width: 44px; height: 44px; border-radius: 50%; background: #7c5cfc; color: white;
    display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;
    transition: transform 0.2s, background 0.2s;
    box-shadow: 0 4px 12px rgba(124, 92, 252, 0.4);
  }
  .playback-btn:hover { background: #8b6fff; transform: scale(1.05); }

  .time-inputs { display: flex; gap: 16px; }
  .input-field { display: flex; flex-direction: column; gap: 2px; }
  .input-field span { font-size: 0.65rem; text-transform: uppercase; color: #888; font-weight: 800; letter-spacing: 0.05em; }
  .input-field strong { font-size: 0.95rem; color: white; font-family: 'JetBrains Mono', 'Courier New', monospace; }

  .actions { margin-left: auto; display: flex; gap: 10px; }
  .btn-cancel { background: transparent; color: #aaa; border: none; cursor: pointer; font-weight: 700; font-size: 0.9rem; padding: 8px 12px; border-radius: 6px; transition: color 0.2s, background 0.2s; }
  .btn-cancel:hover { color: white; background: rgba(255,255,255,0.05); }
  .btn-apply { background: white; color: black; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 800; cursor: pointer; transition: transform 0.2s, opacity 0.2s; }
  .btn-apply:hover { transform: translateY(-2px); opacity: 0.9; }

  .trimmer-status { height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #aaa; font-weight: 600; }
  .spinner { width: 32px; height: 32px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #7c5cfc; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  
  .trimmer-status.error { color: #f87171; }
</style>