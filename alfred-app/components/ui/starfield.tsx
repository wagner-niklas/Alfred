"use client";

import * as React from "react";
import { useTheme } from "next-themes";

const STAR_COUNT = 40;

type Star = {
  id: number;
  size: number;
  top: number;
  left: number;
  duration: number;
  delay: number;
};

export function Starfield() {
  const [mounted, setMounted] = React.useState(false);
  const [stars, setStars] = React.useState<Star[]>([]);
  const { resolvedTheme } = useTheme();

  // Verhindert Hydration-Mismatches: erst nach Mount rendern
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Sterne nur auf dem Client generieren
  React.useEffect(() => {
    if (!mounted) return;

    const generated: Star[] = Array.from({ length: STAR_COUNT }).map(
      (_, index) => {
        const size = 1 + Math.random() * 2.5; // 1–3.5 px
        const top = Math.random() * 100; // über den ganzen Viewport verteilt
        const left = Math.random() * 100;
        const duration = 3 + Math.random() * 4; // 3–7s
        const delay = Math.random() * 4;

        return { id: index, size, top, left, duration, delay };
      }
    );

    setStars(generated);
  }, [mounted]);

  // Erst nach Mount anzeigen (verhindert Hydration-Issues)
  // und nur im Dark-Mode rendern
  if (!mounted || resolvedTheme !== "dark") {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="starfield-root pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {stars.map((star) => (
        <span
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            width: star.size,
            height: star.size,
            top: `${star.top}%`,
            left: `${star.left}%`,
            opacity: 0.8,
            animation: `star-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}
