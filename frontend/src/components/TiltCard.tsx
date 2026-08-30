"use client";

import { useRef, useState, ReactNode, MouseEvent } from "react";
import { motion } from "framer-motion";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  scale?: number;
  glare?: boolean;
  glareMaxOpacity?: number;
  perspective?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export default function TiltCard({
  children,
  className = "",
  maxTilt = 10,
  scale = 1.025,
  glare = true,
  glareMaxOpacity = 0.16,
  perspective = 1000,
  onClick,
  style = {},
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({
    rotateX: 0,
    rotateY: 0,
    glareX: 50,
    glareY: 50,
    glareOpacity: 0,
    isHovered: false,
  });

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = -((y - centerY) / centerY) * maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;

    setTilt({
      rotateX,
      rotateY,
      glareX,
      glareY,
      glareOpacity: glareMaxOpacity,
      isHovered: true,
    });
  };

  const handleMouseLeave = () => {
    setTilt((prev) => ({
      ...prev,
      rotateX: 0,
      rotateY: 0,
      glareOpacity: 0,
      isHovered: false,
    }));
  };

  const transformStyle = tilt.isHovered
    ? `perspective(${perspective}px) rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg)`
    : `perspective(${perspective}px) rotateX(0deg) rotateY(0deg)`;

  return (
    <motion.div
      ref={cardRef}
      className={`tilt-card-container ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      whileHover={{ scale }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      style={{
        transform: transformStyle,
        transformStyle: "preserve-3d",
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      <div className="tilt-card-content" style={{ transform: "translateZ(18px)", height: "100%" }}>
        {children}
      </div>

      {glare && (
        <motion.div
          className="tilt-card-glare"
          aria-hidden="true"
          animate={{
            opacity: tilt.isHovered ? 1 : 0,
          }}
          transition={{ duration: 0.2 }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: "inherit",
            pointerEvents: "none",
            background: `radial-gradient(circle at ${tilt.glareX}% ${tilt.glareY}%, rgba(255, 255, 255, ${tilt.glareOpacity}) 0%, transparent 65%)`,
            zIndex: 10,
          }}
        />
      )}
    </motion.div>
  );
}
