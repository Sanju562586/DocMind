"use client";

import { useEffect, useState } from "react";

interface NeuralWaveformProps {
  label?: string;
  barCount?: number;
  active?: boolean;
}

export default function NeuralWaveform({
  label = "Synthesizing Document Intelligence",
  barCount = 18,
  active = true,
}: NeuralWaveformProps) {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: barCount }, () => Math.random() * 60 + 20)
  );

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setHeights((prev) =>
        prev.map((_, i) => {
          const wave = Math.sin(Date.now() * 0.005 + i * 0.4) * 35;
          const noise = Math.random() * 35;
          return Math.max(15, Math.min(95, 45 + wave + noise));
        })
      );
    }, 90);

    return () => clearInterval(interval);
  }, [active, barCount]);

  return (
    <div className="neural-waveform-container">
      <div className="neural-waveform-bars">
        {heights.map((h, i) => (
          <div
            key={i}
            className="neural-waveform-bar"
            style={{
              height: `${active ? h : 15}%`,
              transition: "height 0.09s ease-out",
              opacity: 0.35 + (i / barCount) * 0.65,
            }}
          />
        ))}
      </div>
      {label && <span className="neural-waveform-label">{label}</span>}
    </div>
  );
}
