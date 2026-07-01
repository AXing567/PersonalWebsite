import { useEffect, useRef } from "react";
import { onSiteThemeChange, type SiteTheme } from "../hooks/useSiteTheme";

type Particle = {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  hue: number;
  alpha: number;
};

type ThemePaint = {
  aurora: string;
  line: string;
  particleHue: number;
  particleHueRange: number;
  stops: [number, string][];
  violet: string;
};

const themePaints: Record<SiteTheme, ThemePaint> = {
  aurora: {
    aurora: "rgba(78, 167, 255, 0.2)",
    line: "rgba(140, 204, 255, ",
    particleHue: 188,
    particleHueRange: 52,
    stops: [
      [0, "#07111e"],
      [0.42, "#101526"],
      [1, "#05090f"],
    ],
    violet: "rgba(151, 116, 255, 0.15)",
  },
  frost: {
    aurora: "rgba(132, 212, 255, 0.18)",
    line: "rgba(122, 188, 235, ",
    particleHue: 198,
    particleHueRange: 38,
    stops: [
      [0, "#eef7fb"],
      [0.46, "#dcebf4"],
      [1, "#c9dce8"],
    ],
    violet: "rgba(148, 165, 190, 0.13)",
  },
  moss: {
    aurora: "rgba(126, 210, 160, 0.16)",
    line: "rgba(142, 214, 160, ",
    particleHue: 118,
    particleHueRange: 42,
    stops: [
      [0, "#0c1511"],
      [0.46, "#142018"],
      [1, "#060b09"],
    ],
    violet: "rgba(205, 180, 110, 0.12)",
  },
};

const getCurrentTheme = (): SiteTheme => {
  const theme = document.documentElement.dataset.siteTheme;
  return theme === "frost" || theme === "moss" || theme === "aurora" ? theme : "aurora";
};

export default function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let particles: Particle[] = [];
    let activeTheme = getCurrentTheme();

    const createParticles = () => {
      const count = Math.min(76, Math.max(34, Math.floor((width * height) / 26000)));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.2 + Math.random() * 3.4,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.18,
        hue: themePaints[activeTheme].particleHue + Math.random() * themePaints[activeTheme].particleHueRange,
        alpha: 0.16 + Math.random() * 0.38,
      }));
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      createParticles();
    };

    const draw = () => {
      const paint = themePaints[activeTheme];
      const gradient = context.createLinearGradient(0, 0, width, height);
      paint.stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const aurora = context.createRadialGradient(width * 0.24, height * 0.12, 0, width * 0.24, height * 0.12, width * 0.72);
      aurora.addColorStop(0, paint.aurora);
      aurora.addColorStop(0.44, "rgba(81, 214, 187, 0.08)");
      aurora.addColorStop(1, "rgba(5, 9, 15, 0)");
      context.fillStyle = aurora;
      context.fillRect(0, 0, width, height);

      const violet = context.createRadialGradient(width * 0.86, height * 0.28, 0, width * 0.86, height * 0.28, width * 0.55);
      violet.addColorStop(0, paint.violet);
      violet.addColorStop(1, "rgba(5, 9, 15, 0)");
      context.fillStyle = violet;
      context.fillRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -20) particle.x = width + 20;
        if (particle.x > width + 20) particle.x = -20;
        if (particle.y < -20) particle.y = height + 20;
        if (particle.y > height + 20) particle.y = -20;

        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = `hsla(${particle.hue}, 92%, 76%, ${particle.alpha})`;
        context.fill();

        for (let j = index + 1; j < particles.length; j += 1) {
          const other = particles[j];
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 118) {
            context.strokeStyle = `${paint.line}${0.09 * (1 - distance / 118)})`;
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(particle.x, particle.y);
            context.lineTo(other.x, other.y);
            context.stroke();
          }
        }
      });

      animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    const unsubscribeThemeChange = onSiteThemeChange((theme) => {
      activeTheme = theme;
      createParticles();
    });

    return () => {
      window.removeEventListener("resize", resize);
      unsubscribeThemeChange();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas aria-hidden="true" className="ambient-canvas" ref={canvasRef} />;
}
