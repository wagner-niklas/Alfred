"use client";

import * as React from "react";
import { useTheme } from "next-themes";

const STAR_COUNT = 40;
const MIN_SHOOTING_STARS = 1;
const MAX_SHOOTING_STARS = 2;

type Star = {
  id: number;
  size: number;
  top: number;
  left: number;
  duration: number;
  delay: number;
};

type ShootingStar = {
  id: number;
  top: number;
  left: number;
  length: number;
  duration: number;
  delay: number;
  travelX: number;
  travelY: number;
  angle: number;
};

export function Starfield() {
  const [mounted, setMounted] = React.useState(false);
  const [stars, setStars] = React.useState<Star[]>([]);
  const [shootingStars, setShootingStars] = React.useState<ShootingStar[]>([]);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;

    // ✨ Static stars
    const generated: Star[] = Array.from({ length: STAR_COUNT }).map(
      (_, index) => {
        const size = 1 + Math.random() * 2.5;
        const top = Math.random() * 100;
        const left = Math.random() * 100;
        const duration = 3 + Math.random() * 4;
        const delay = Math.random() * 4;

        return { id: index, size, top, left, duration, delay };
      }
    );

    setStars(generated);

    // 🌠 Shooting stars
    const shootingStarCount =
      MIN_SHOOTING_STARS +
      Math.floor(Math.random() * (MAX_SHOOTING_STARS - MIN_SHOOTING_STARS + 1));

    const generatedShootingStars: ShootingStar[] = Array.from({
      length: shootingStarCount,
    }).map((_, index) => {
      const top = 18 + Math.random() * 44;
      const left = 14 + Math.random() * 52;
      const length = 28 + Math.random() * 32;
      const duration = 12 + Math.random() * 10;
      const delay = Math.random() * 18;

      // 🎯 Generate a natural diagonal direction
      const baseAngle = -30 + Math.random() * 60; // degrees
      const rad = (baseAngle * Math.PI) / 180;

      const distance = 12 + Math.random() * 10;

      const travelX = Math.cos(rad) * distance;
      const travelY = Math.sin(rad) * distance;

      return {
        id: index,
        top,
        left,
        length,
        duration,
        delay,
        travelX,
        travelY,
        angle: baseAngle,
      };
    });

    setShootingStars(generatedShootingStars);
  }, [mounted]);

  if (!mounted || resolvedTheme !== "dark") {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="starfield-root pointer-events-none fixed inset-0 z-11 overflow-hidden"
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

      {shootingStars.map((shootingStar) => (
        <span
          key={shootingStar.id}
          className="shooting-star absolute h-px rounded-full"
          style={
            {
              top: `${shootingStar.top}%`,
              left: `${shootingStar.left}%`,
              width: shootingStar.length,

              // 🔥 Tail points opposite to movement
              "--shooting-star-angle": `${shootingStar.angle + 180}deg`,
              "--shooting-star-travel-x": `${shootingStar.travelX}vw`,
              "--shooting-star-travel-y": `${shootingStar.travelY}vh`,

              // smoother, more natural motion
              animation: `shooting-star ${shootingStar.duration}s cubic-bezier(0.3, 0, 0.7, 1) ${shootingStar.delay}s infinite`,
            } as React.CSSProperties & Record<`--${string}`, string>
          }
        />
      ))}
    </div>
  );
}