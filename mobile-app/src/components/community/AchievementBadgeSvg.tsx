import React from "react";
import { View } from "react-native";
import Svg, {
  Circle, Defs, G, LinearGradient,
  Polygon, RadialGradient, Rect, Stop,
} from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { Achievement } from "../../types/gamification";

const SvgDefs = Defs as React.ComponentType<{ children?: React.ReactNode }>;

// ── Config de TIER — cor do anel + quantidade de decorações no anel ────────────
// O tier comunica prestígio: bronze < silver < gold < diamond < special
const TIER_CFG = {
  bronze:  { bg1: "#92400e", bg2: "#5c2600", ring: "#b45309", iconColor: "#fde68a", decoCount: 4  },
  silver:  { bg1: "#374151", bg2: "#111827", ring: "#6b7280", iconColor: "#d1d5db", decoCount: 8  },
  gold:    { bg1: "#a16207", bg2: "#78350f", ring: "#ca8a04", iconColor: "#fef9c3", decoCount: 8  },
  diamond: { bg1: "#075985", bg2: "#082f49", ring: "#0284c7", iconColor: "#7dd3fc", decoCount: 6  },
  special: { bg1: "#5b21b6", bg2: "#2e1065", ring: "#7c3aed", iconColor: "#ddd6fe", decoCount: 12 },
} as const;

// ── Config de ÍCONE — glow interno + formato das decorações do anel ────────────
// O ícone (= conditionType) comunica o tipo específico de conquista.
// Cada tipo tem: uma cor de glow única e um formato de decoração único.
// O anel usa ESTA cor e ESTE formato, mas a contagem de elementos vem do tier.
const ICON_CFG: Record<string, { glow: string; deco: string }> = {
  flame:        { glow: "#f97316", deco: "flame"      }, // STREAK_SESSIONS
  barbell:      { glow: "#4ade80", deco: "barbell"    }, // TOTAL_WORKOUTS
  "person-add": { glow: "#22d3ee", deco: "plus"       }, // TOTAL_FOLLOWING
  people:       { glow: "#a78bfa", deco: "twoCircles" }, // TOTAL_FOLLOWERS
  star:         { glow: "#fbbf24", deco: "star5"      }, // TOTAL_REVIEWS_SUBMITTED
  camera:       { glow: "#f472b6", deco: "lens"       }, // TOTAL_PHOTO_POSTS
  fitness:      { glow: "#34d399", deco: "diamond4"   }, // DISTINCT_PROVIDERS_TRAINED
  trophy:       { glow: "#fb923c", deco: "podium"     }, // WEEKLY_TOP3_REACHED
  medal:        { glow: "#fde047", deco: "crown"      }, // WEEKLY_1ST_REACHED
  infinite:     { glow: "#c084fc", deco: "infinity"   }, // WEEKLY_TOP3_CONSECUTIVE_WEEKS
  flash:        { glow: "#60a5fa", deco: "bolt"       }, // LEVEL_REACHED
  ribbon:       { glow: "#f9a8d4", deco: "star5"      }, // genérico/fallback
};
const ICON_FALLBACK = { glow: "#94a3b8", deco: "dot" };

// ── Elemento decorativo individual no anel ────────────────────────────────────
// (x, y) = posição no midR do anel; r = raio da forma; color = glow da condição
function DecoEl({ shape, x, y, r, color }: {
  shape: string; x: number; y: number; r: number; color: string;
}) {
  const sw = Math.max(0.8, r * 0.3);
  switch (shape) {
    case "flame":
      return (
        <Polygon
          points={`${x},${y - r * 1.1} ${x + r * 0.55},${y + r * 0.7} ${x},${y + r * 0.2} ${x - r * 0.55},${y + r * 0.7}`}
          fill={color}
        />
      );

    case "bolt":
      return (
        <Polygon
          points={[
            `${x + r * 0.25},${y - r}`,
            `${x - r * 0.5},${y - r * 0.05}`,
            `${x + r * 0.1},${y - r * 0.05}`,
            `${x - r * 0.25},${y + r}`,
            `${x + r * 0.5},${y + r * 0.05}`,
            `${x - r * 0.1},${y + r * 0.05}`,
          ].join(" ")}
          fill={color}
        />
      );

    case "crown":
      return (
        <Polygon
          points={[
            `${x - r},${y + r * 0.75}`,
            `${x - r},${y - r * 0.1}`,
            `${x - r * 0.35},${y - r}`,
            `${x},${y + r * 0.1}`,
            `${x + r * 0.35},${y - r}`,
            `${x + r},${y - r * 0.1}`,
            `${x + r},${y + r * 0.75}`,
          ].join(" ")}
          fill={color}
        />
      );

    case "star5": {
      const pts = Array.from({ length: 10 }, (_, j) => {
        const a = (j * Math.PI) / 5 - Math.PI / 2;
        const rad = j % 2 === 0 ? r : r * 0.42;
        return `${x + rad * Math.cos(a)},${y + rad * Math.sin(a)}`;
      }).join(" ");
      return <Polygon points={pts} fill={color} />;
    }

    case "diamond4": {
      const pts = Array.from({ length: 8 }, (_, j) => {
        const a = (j * Math.PI) / 4 - Math.PI / 4;
        const rad = j % 2 === 0 ? r : r * 0.38;
        return `${x + rad * Math.cos(a)},${y + rad * Math.sin(a)}`;
      }).join(" ");
      return <Polygon points={pts} fill={color} />;
    }

    case "plus":
      return (
        <G>
          <Rect x={x - r * 0.18} y={y - r}        width={r * 0.36} height={r * 2}    rx={r * 0.15} fill={color} />
          <Rect x={x - r}        y={y - r * 0.18}  width={r * 2}    height={r * 0.36} rx={r * 0.15} fill={color} />
        </G>
      );

    case "infinity":
      return (
        <G>
          <Circle cx={x - r * 0.42} cy={y} r={r * 0.55} stroke={color} strokeWidth={sw} fill="none" />
          <Circle cx={x + r * 0.42} cy={y} r={r * 0.55} stroke={color} strokeWidth={sw} fill="none" />
        </G>
      );

    case "lens":
      return (
        <G>
          <Circle cx={x} cy={y} r={r}        stroke={color} strokeWidth={sw} fill="none" />
          <Circle cx={x} cy={y} r={r * 0.38} fill={color} />
        </G>
      );

    case "twoCircles":
      return (
        <G>
          <Circle cx={x - r * 0.38} cy={y} r={r * 0.58} fill={color} />
          <Circle cx={x + r * 0.38} cy={y} r={r * 0.5}  fill={color} opacity={0.65} />
        </G>
      );

    case "podium":
      return (
        <G>
          <Rect x={x - r * 0.95} y={y - r * 0.45} width={r * 0.58} height={r * 1.45} rx={r * 0.1} fill={color} />
          <Rect x={x - r * 0.3}  y={y - r}         width={r * 0.62} height={r * 2}    rx={r * 0.1} fill={color} />
          <Rect x={x + r * 0.38} y={y - r * 0.2}   width={r * 0.58} height={r * 1.2}  rx={r * 0.1} fill={color} />
        </G>
      );

    case "barbell":
      return (
        <G>
          <Circle cx={x - r * 0.62} cy={y} r={r * 0.48} fill={color} />
          <Rect   x={x - r * 0.62}  y={y - r * 0.16} width={r * 1.24} height={r * 0.32} fill={color} />
          <Circle cx={x + r * 0.62} cy={y} r={r * 0.48} fill={color} />
        </G>
      );

    default:
      return <Circle cx={x} cy={y} r={r * 0.48} fill={color} />;
  }
}

// ── Componente principal ──────────────────────────────────────────────────────
interface Props {
  tier: Achievement["tier"];
  /** Nome do ícone Ionicons (= conditionType mapeado) — determina glow + deco */
  icon: string;
  category?: string;
  size?: number;
  unlocked?: boolean;
}

export function AchievementBadgeSvg({ tier, icon, size = 48, unlocked = true }: Props) {
  const tc = TIER_CFG[tier];
  const ic = ICON_CFG[icon] ?? ICON_FALLBACK;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 1.5;
  const ringWidth = Math.max(5, size * 0.13);
  const innerR = outerR - ringWidth;
  const midR = (outerR + innerR) / 2;
  const decoR = Math.max(3, size * 0.067);
  const iconSize = Math.round(size * 0.38);

  const decos = Array.from({ length: tc.decoCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / tc.decoCount - Math.PI / 2;
    return (
      <DecoEl
        key={i}
        shape={ic.deco}
        x={cx + midR * Math.cos(angle)}
        y={cy + midR * Math.sin(angle)}
        r={decoR}
        color={ic.glow}
      />
    );
  });

  const bgId    = `bg-${icon}-${tier}`;
  const glowId  = `glow-${icon}-${tier}`;
  const haloId  = `halo-${icon}-${tier}`;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <SvgDefs>
          {/* Gradiente de fundo: cor do tier */}
          <LinearGradient id={bgId} x1="0.3" y1="0" x2="0.7" y2="1">
            <Stop offset="0%" stopColor={tc.bg1} />
            <Stop offset="100%" stopColor={tc.bg2} />
          </LinearGradient>
          {/* Glow central: cor da condição — identidade única de cada conquista */}
          <RadialGradient id={glowId} cx="50%" cy="45%" r="55%">
            <Stop offset="0%"   stopColor={ic.glow} stopOpacity={unlocked ? "0.48" : "0"} />
            <Stop offset="60%"  stopColor={ic.glow} stopOpacity={unlocked ? "0.10" : "0"} />
            <Stop offset="100%" stopColor={ic.glow} stopOpacity="0" />
          </RadialGradient>
          {/* Halo periférico: cor do tier — reforça o prestígio */}
          <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
            <Stop offset="70%"  stopColor={tc.ring} stopOpacity="0" />
            <Stop offset="100%" stopColor={tc.ring} stopOpacity={unlocked ? "0.22" : "0"} />
          </RadialGradient>
        </SvgDefs>

        {/* Fundo interno */}
        <Circle cx={cx} cy={cy} r={innerR} fill={`url(#${bgId})`} opacity={unlocked ? 1 : 0.35} />
        {/* Glow de condição */}
        <Circle cx={cx} cy={cy} r={innerR} fill={`url(#${glowId})`} />
        {/* Halo de tier */}
        <Circle cx={cx} cy={cy} r={outerR} fill={`url(#${haloId})`} />

        {/* Anel externo: cor do tier (indica prestígio) */}
        <Circle
          cx={cx} cy={cy} r={outerR}
          stroke={tc.ring} strokeWidth={Math.max(1.4, size * 0.032)}
          fill="none" opacity={unlocked ? 1 : 0.28}
        />
        {/* Borda interna do anel */}
        <Circle
          cx={cx} cy={cy} r={innerR}
          stroke={tc.ring} strokeWidth={0.7}
          fill="none" opacity={unlocked ? 0.35 : 0.1}
        />

        {/* Decorações no anel: formato = condição; quantidade = tier */}
        <G opacity={unlocked ? 0.88 : 0.22}>{decos}</G>
      </Svg>

      {/* Ícone da conquista sobreposto ao centro */}
      <View
        style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          alignItems: "center", justifyContent: "center",
          opacity: unlocked ? 1 : 0.30,
        }}
      >
        <Ionicons name={icon as any} size={iconSize} color={unlocked ? tc.iconColor : "#6b7280"} />
      </View>
    </View>
  );
}
