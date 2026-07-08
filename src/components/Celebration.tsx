import React, { useEffect, useMemo, useState } from "react";

const EMOJIS = ["🦄", "🌈", "🍦", "🧜‍♀️", "🐱", "✨", "🎉", "💖", "🍭", "🌟", "🎊", "🍩"];
const COLORS = [
  "#ff0000",
  "#ff7f00",
  "#ffff00",
  "#00ff00",
  "#0000ff",
  "#4b0082",
  "#8f00ff",
  "#ff3dad",
  "#00ddff",
  "#ff6b9d",
  "#c4ff00",
];

type Variant = 0 | 1 | 2;

type ConfettiPiece = {
  id: number;
  left: number;
  top?: number;
  delay: number;
  duration: number;
  color: string;
  w: number;
  h: number;
  shape: "rect" | "circle" | "strip";
  drift: number;
  spin: number;
  originX?: number;
  originY?: number;
};

type Props = {
  variant?: number;
  onFinish: () => void;
  onDisable: () => void;
  showDisablePrompt: boolean;
  onDismissPrompt: () => void;
};

const VARIANT_LABELS = ["shower", "burst", "spiral"] as const;

function buildConfetti(variant: Variant): ConfettiPiece[] {
  const count = variant === 1 ? 180 : 160;
  return Array.from({ length: count }, (_, i) => {
    const base = {
      id: i,
      delay: Math.random() * (variant === 1 ? 0.35 : 0.75),
      duration: 2.2 + Math.random() * 1.8,
      color: COLORS[i % COLORS.length],
      w: 5 + Math.random() * 10,
      h: 4 + Math.random() * 7,
      shape: (["rect", "circle", "strip"] as const)[i % 3],
      drift: (Math.random() - 0.5) * (variant === 2 ? 220 : 120),
      spin: 360 + Math.random() * 720,
    };

    if (variant === 1) {
      const origins = [
        { x: 50, y: 88 },
        { x: 12, y: 92 },
        { x: 88, y: 92 },
        { x: 30, y: 85 },
        { x: 70, y: 85 },
      ];
      const o = origins[i % origins.length];
      return {
        ...base,
        left: o.x + (Math.random() - 0.5) * 8,
        top: o.y,
        originX: o.x,
        originY: o.y,
        duration: 1.6 + Math.random() * 1.4,
      };
    }

    return {
      ...base,
      left: Math.random() * 100,
      top: variant === 2 ? -8 - Math.random() * 15 : -12 - Math.random() * 20,
    };
  });
}

type Facet = { id: number; rx: number; ry: number; shade: number; w: number; h: number };

const DISCO_RADIUS = 34;

function buildFacets(): Facet[] {
  const facets: Facet[] = [];
  const latBands = [-75, -50, -25, 0, 25, 50, 75];
  latBands.forEach((lat, band) => {
    const count = band === 3 ? 16 : band === 0 || band === 6 ? 7 : 11;
    const stagger = band % 2 ? 180 / count : 0;
    for (let i = 0; i < count; i++) {
      facets.push({
        id: facets.length,
        rx: lat,
        ry: (360 / count) * i + stagger,
        shade: (i + band) % 6,
        w: band === 3 ? 12 : 10,
        h: band === 3 ? 10 : 8,
      });
    }
  });
  return facets;
}

const DISCO_FACETS = buildFacets();

function DiscoBall() {
  return (
    <div className="disco-scene">
      <div className="disco-string" />
      <div className="disco-hanger">
        <div className="disco-ball-3d">
          <div className="disco-core" />
          {DISCO_FACETS.map((f) => (
            <div
              key={f.id}
              className="disco-facet"
              style={{
                width: f.w,
                height: f.h,
                marginLeft: -f.w / 2,
                marginTop: -f.h / 2,
                transform: `rotateY(${f.ry}deg) rotateX(${f.rx}deg) translateZ(${DISCO_RADIUS}px)`,
              }}
            >
              <div className={`disco-facet-inner shade-${f.shade}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="disco-beams">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="disco-beam" style={{ "--beam-i": i } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

export function Celebration({
  variant = 0,
  onFinish,
  onDisable,
  showDisablePrompt,
  onDismissPrompt,
}: Props) {
  const [phase, setPhase] = useState<"party" | "prompt">("party");
  const v = (variant % 3) as Variant;
  const animClass = VARIANT_LABELS[v];

  const confetti = useMemo(() => buildConfetti(v), [v]);

  const floats = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        emoji: EMOJIS[i % EMOJIS.length],
        left: 4 + Math.random() * 92,
        delay: Math.random() * 1,
        duration: 2.2 + Math.random() * 1.6,
        scale: 0.85 + Math.random() * 1.5,
        path: i % 3,
      })),
    [v]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (showDisablePrompt) setPhase("prompt");
      else onFinish();
    }, 3200);
    return () => window.clearTimeout(t);
  }, [showDisablePrompt, onFinish]);

  if (phase === "prompt") {
    return (
      <div className="celebration-prompt-overlay" role="dialog" aria-modal="true">
        <style>{css}</style>
        <div className="celebration-prompt">
          <div className="celebration-prompt-emoji">🦄🌈🪩</div>
          <h3>Task crushed!</h3>
          <p className="muted tiny">
            Celebrations are on. Not everyone wants a disco unicorn every time — totally fair.
          </p>
          <div className="row gap wrap" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="tiny" onClick={onDismissPrompt}>
              Keep celebrating 🎉
            </button>
            <button
              className="tiny"
              onClick={() => {
                onDisable();
                onFinish();
              }}
            >
              Turn off celebrations
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`celebration-overlay celebration-${animClass}`} aria-hidden="true">
      <style>{css}</style>
      <DiscoBall />
      {confetti.map((c) => (
        <span
          key={c.id}
          className={`confetti confetti-${c.shape} confetti-${animClass}`}
          style={
            {
              left: `${c.left}%`,
              top: c.top != null ? `${c.top}%` : undefined,
              "--drift": `${c.drift}px`,
              "--spin": `${c.spin}deg`,
              "--ox": `${c.originX ?? 50}%`,
              "--oy": `${c.originY ?? 0}%`,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              background: c.color,
              width: c.w,
              height: c.h,
            } as React.CSSProperties
          }
        />
      ))}
      {floats.map((f) => (
        <span
          key={f.id}
          className={`float-emoji float-path-${f.path}`}
          style={{
            left: `${f.left}%`,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
            fontSize: `${f.scale}rem`,
          }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}

const css = `
.celebration-overlay, .celebration-prompt-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
  overflow: hidden;
}
.celebration-prompt-overlay {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 24, 0.55);
  backdrop-filter: blur(3px);
}
.celebration-prompt {
  pointer-events: auto;
  background: var(--card, #1a1042);
  border: 2px solid var(--accent, #ff3dad);
  border-radius: 16px;
  padding: 24px;
  max-width: 340px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.45);
}
.celebration-prompt h3 { margin: 8px 0; font-size: 18px; }
.celebration-prompt-emoji { font-size: 2rem; line-height: 1.2; }

/* 3D disco ball — mirror facets on a sphere */
.disco-scene {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 140px;
  height: 150px;
  perspective: 900px;
  perspective-origin: 50% 18%;
}
.disco-string {
  position: absolute;
  top: 0;
  left: 50%;
  width: 2px;
  height: 30px;
  margin-left: -1px;
  background: linear-gradient(180deg, #666, #ddd);
  border-radius: 1px;
  z-index: 2;
}
.disco-hanger {
  position: absolute;
  top: 28px;
  left: 50%;
  transform: translateX(-50%) rotateX(18deg);
  transform-style: preserve-3d;
  animation: disco-sway 2.6s ease-in-out infinite alternate;
}
.disco-ball-3d {
  position: relative;
  width: 68px;
  height: 68px;
  transform-style: preserve-3d;
  animation: disco-rotate-y 3.2s linear infinite;
}
.disco-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 66px;
  height: 66px;
  margin: -33px 0 0 -33px;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #5a5a5a 0%, #1c1c1c 52%, #050505 100%);
  box-shadow:
    inset -12px -16px 28px rgba(0, 0, 0, 0.85),
    inset 4px 6px 14px rgba(255, 255, 255, 0.12);
  transform: translateZ(0);
}
.disco-facet {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-style: preserve-3d;
  backface-visibility: visible;
}
.disco-facet-inner {
  width: 100%;
  height: 100%;
  border: 0.5px solid rgba(255, 255, 255, 0.55);
  box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.85);
}
.disco-facet-inner.shade-0 { background: linear-gradient(140deg, #ffffff 0%, #d8dde5 50%, #6b7280 100%); }
.disco-facet-inner.shade-1 { background: linear-gradient(140deg, #f0f4f8 0%, #b8c0cc 50%, #4b5563 100%); }
.disco-facet-inner.shade-2 { background: linear-gradient(140deg, #e8edf3 0%, #9aa3b0 50%, #374151 100%); }
.disco-facet-inner.shade-3 { background: linear-gradient(140deg, #fff 0%, #c9d1dc 45%, #525b6a 100%); }
.disco-facet-inner.shade-4 { background: linear-gradient(140deg, #f5f8fc 0%, #aeb8c6 50%, #434c5c 100%); }
.disco-facet-inner.shade-5 { background: linear-gradient(140deg, #fafcff 0%, #d0d8e4 48%, #5c6678 100%); }
.disco-beams {
  position: absolute;
  top: 58px;
  left: 50%;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  pointer-events: none;
}
.disco-beam {
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  height: 42vh;
  transform-origin: top center;
  transform: rotate(calc(var(--beam-i) * 45deg));
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(255, 62, 173, 0.35) 25%,
    rgba(45, 156, 255, 0.2) 55%,
    transparent 100%
  );
  opacity: 0;
  animation: disco-beam-flash 3.2s ease-in-out infinite;
  animation-delay: calc(var(--beam-i) * 0.12s);
  filter: blur(1px);
}

.confetti {
  position: absolute;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
  will-change: transform, opacity;
}
.confetti-circle { border-radius: 50%; }
.confetti-strip { border-radius: 999px; height: 3px !important; }
.confetti-shower {
  top: -20px;
  animation-name: confetti-shower;
}
.confetti-burst {
  animation-name: confetti-burst;
}
.confetti-spiral {
  top: -20px;
  animation-name: confetti-spiral;
}

.float-emoji {
  position: absolute;
  bottom: -12%;
  animation-timing-function: ease-out;
  animation-fill-mode: forwards;
}
.float-path-0 { animation-name: emoji-rise-a; }
.float-path-1 { animation-name: emoji-rise-b; }
.float-path-2 { animation-name: emoji-rise-c; }

@keyframes disco-rotate-y {
  from { transform: rotateY(0deg); }
  to { transform: rotateY(360deg); }
}
@keyframes disco-sway {
  from { transform: translateX(-50%) rotateX(18deg) rotateZ(-5deg); }
  to { transform: translateX(-50%) rotateX(18deg) rotateZ(5deg); }
}
@keyframes disco-beam-flash {
  0%, 100% { opacity: 0; }
  15%, 35% { opacity: 0.85; }
  50% { opacity: 0.15; }
  65%, 85% { opacity: 0.7; }
}

@keyframes confetti-shower {
  0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(115vh) translateX(var(--drift)) rotate(var(--spin)); opacity: 0.15; }
}
@keyframes confetti-burst {
  0% {
    transform: translate(-50%, -50%) scale(0.15) rotate(0deg);
    opacity: 1;
  }
  8% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(45deg); }
  100% {
    transform: translate(calc(-50% + var(--drift)), calc(-50% - 115vh)) rotate(var(--spin));
    opacity: 0.08;
  }
}
@keyframes confetti-spiral {
  0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
  25% { transform: translateY(28vh) translateX(calc(var(--drift) * 0.5)) rotate(calc(var(--spin) * 0.25)); }
  50% { transform: translateY(55vh) translateX(calc(var(--drift) * -0.35)) rotate(calc(var(--spin) * 0.5)); }
  75% { transform: translateY(82vh) translateX(calc(var(--drift) * 0.65)) rotate(calc(var(--spin) * 0.75)); }
  100% { transform: translateY(115vh) translateX(var(--drift)) rotate(var(--spin)); opacity: 0.12; }
}

@keyframes emoji-rise-a {
  0% { transform: translateY(0) scale(0.4) rotate(-15deg); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translateY(-108vh) scale(1.25) rotate(20deg); opacity: 0; }
}
@keyframes emoji-rise-b {
  0% { transform: translateY(0) translateX(0) scale(0.5); opacity: 0; }
  15% { opacity: 1; }
  50% { transform: translateY(-52vh) translateX(40px) scale(1.1) rotate(-12deg); }
  100% { transform: translateY(-110vh) translateX(-30px) scale(1.3) rotate(30deg); opacity: 0; }
}
@keyframes emoji-rise-c {
  0% { transform: translateY(0) scale(0.55); opacity: 0; }
  10% { opacity: 1; }
  100% { transform: translateY(-112vh) scale(1.15) rotate(-25deg); opacity: 0; }
}
`;
