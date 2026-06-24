"use client";

import { useEffect, useRef, useState } from "react";

export function NumberRoll({ value }: { value: number }) {
  const [displayed, setDisplayed] = useState(value);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const fromRef = useRef(value);

  useEffect(() => {
    fromRef.current = displayed;
    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const duration = 300;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(
        fromRef.current + (value - fromRef.current) * eased,
      );
      setDisplayed(current);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value]);

  return (
    <span className="tabular-nums transition-none">
      {displayed}
    </span>
  );
}
