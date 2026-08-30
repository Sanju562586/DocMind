"use client";

import { useEffect, useRef } from "react";

interface Particle3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  baseAlpha: number;
  pulseSpeed: number;
  pulsePhase: number;
}

interface InteractiveBackgroundProps {
  isStreaming?: boolean;
}

export default function InteractiveBackground({ isStreaming = false }: InteractiveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.targetX = (e.clientX - width / 2) / (width / 2);
      mouseRef.current.targetY = (e.clientY - height / 2) / (height / 2);
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.targetX = 0;
      mouseRef.current.targetY = 0;
      mouseRef.current.active = false;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handleMouseLeave, { passive: true });

    // Check prefers-reduced-motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = mediaQuery.matches;

    // Generate 3D Particle Cloud
    const countLimit = prefersReducedMotion ? 25 : Math.min(Math.floor((width * height) / 14000), 80);
    const particles: Particle3D[] = [];
    const fov = 420;

    for (let i = 0; i < countLimit; i++) {
      particles.push({
        x: (Math.random() - 0.5) * width * 1.3,
        y: (Math.random() - 0.5) * height * 1.3,
        z: Math.random() * fov,
        vx: (Math.random() - 0.5) * (prefersReducedMotion ? 0.05 : 0.35),
        vy: (Math.random() - 0.5) * (prefersReducedMotion ? 0.05 : 0.35),
        vz: (Math.random() - 0.5) * (prefersReducedMotion ? 0.03 : 0.25),
        radius: Math.random() * 1.7 + 0.8,
        baseAlpha: Math.random() * 0.45 + 0.25,
        pulseSpeed: Math.random() * 0.03 + 0.015,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }

    let time = 0;

    const render = () => {
      time += 0.016;

      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.04;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.04;

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const mouseTiltX = mouseRef.current.x * 0.28;
      const mouseTiltY = mouseRef.current.y * 0.28;
      const speedMultiplier = isStreaming ? 2.0 : prefersReducedMotion ? 0.3 : 1.0;

      const projected: { x: number; y: number; scale: number; alpha: number; radius: number }[] = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.x += p.vx * speedMultiplier;
        p.y += p.vy * speedMultiplier;
        p.z += p.vz * speedMultiplier;

        if (p.x < -width * 0.75) p.x = width * 0.75;
        if (p.x > width * 0.75) p.x = -width * 0.75;
        if (p.y < -height * 0.75) p.y = height * 0.75;
        if (p.y > height * 0.75) p.y = -height * 0.75;
        if (p.z < 10) p.z = fov;
        if (p.z > fov) p.z = 10;

        const rotY = mouseTiltX + Math.sin(time * 0.15) * 0.04;
        const rotX = -mouseTiltY + Math.cos(time * 0.15) * 0.04;

        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const x1 = p.x * cosY + p.z * sinY;
        const z1 = -p.x * sinY + p.z * cosY;

        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;

        const depth = z2 + fov * 0.65;
        if (depth <= 0) continue;

        const scale = fov / depth;
        const screenX = cx + x1 * scale;
        const screenY = cy + y2 * scale;

        const pulse = Math.sin(time * p.pulseSpeed * 60 + p.pulsePhase) * 0.25 + 0.75;
        const depthAlpha = Math.max(0, Math.min(1, 1 - z2 / fov));
        const alpha = p.baseAlpha * depthAlpha * pulse * (isStreaming ? 1.4 : 1.0);

        projected.push({
          x: screenX,
          y: screenY,
          scale,
          alpha: Math.min(alpha, 0.85),
          radius: Math.max(0.6, p.radius * scale),
        });
      }

      // Draw Monochromatic Connecting Lines
      const maxConnectDist = isStreaming ? 140 : 115;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const p1 = projected[i];
          const p2 = projected[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxConnectDist) {
            const lineAlpha = (1 - dist / maxConnectDist) * Math.min(p1.alpha, p2.alpha) * 0.35;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(255, 255, 255, ${lineAlpha * (isStreaming ? 1.5 : 1.0)})`;
            ctx.lineWidth = Math.min(p1.scale, p2.scale) * (isStreaming ? 1.0 : 0.7);
            ctx.stroke();
          }
        }
      }

      // Draw Pure White Projected Particles
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        ctx.fill();

        if (isStreaming || p.alpha > 0.5) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 0.12})`;
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isStreaming]);

  return (
    <div className="interactive-bg-wrapper" aria-hidden="true">
      <div className="interactive-bg-ambient-orb orb-1" />
      <div className="interactive-bg-ambient-orb orb-2" />
      <div className="interactive-bg-ambient-orb orb-3" />
      <canvas ref={canvasRef} className="interactive-bg-canvas" />
      <div className="interactive-bg-grid-overlay" />
    </div>
  );
}
