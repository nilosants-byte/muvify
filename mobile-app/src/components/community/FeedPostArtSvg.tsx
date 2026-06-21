import React from "react";
import { Text, View } from "react-native";
import Svg, {
  Circle, Defs, Ellipse, G, Line,
  LinearGradient, Polygon, RadialGradient, Rect, Stop,
} from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { FeedPost, FeedPostMetadata } from "../../services/api/client";

// react-native-svg 15.x não inclui `children` nos tipos de Defs
const SvgDefs = Defs as React.ComponentType<{ children?: React.ReactNode }>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function starPoints(cx: number, cy: number, r1: number, r2: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

function star4Points(cx: number, cy: number, r1: number, r2: number): string {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4 - Math.PI / 4;
    const r = i % 2 === 0 ? r1 : r2;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(" ");
}

/** N raios triangulares saindo de (cx, cy) */
function Rays({
  cx, cy, innerR, outerR, count, opacity, spreadDeg = 6,
}: {
  cx: number; cy: number; innerR: number; outerR: number;
  count: number; opacity: number; spreadDeg?: number;
}) {
  const spread = (spreadDeg * Math.PI) / 180;
  return (
    <G>
      {Array.from({ length: count }, (_, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const x0 = cx + innerR * Math.cos(angle - spread);
        const y0 = cy + innerR * Math.sin(angle - spread);
        const x1 = cx + innerR * Math.cos(angle + spread);
        const y1 = cy + innerR * Math.sin(angle + spread);
        const x2 = cx + outerR * Math.cos(angle);
        const y2 = cy + outerR * Math.sin(angle);
        return (
          <Polygon key={i} points={`${x0},${y0} ${x1},${y1} ${x2},${y2}`}
            fill="white" opacity={opacity} />
        );
      })}
    </G>
  );
}

// ── Overlay de gradiente inferior (legibilidade do texto) ─────────────────────
function BottomFade({ id }: { id: string }) {
  return (
    <>
      <SvgDefs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="30%" stopColor="#000000" stopOpacity="0" />
          <Stop offset="100%" stopColor="#000000" stopOpacity="0.72" />
        </LinearGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill={`url(#${id})`} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ARTES POR TIPO DE POST
// ══════════════════════════════════════════════════════════════════════════════

// ── Treino Presencial ─────────────────────────────────────────────────────────
function ArtWorkoutGym() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="wg-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#064e3b" />
          <Stop offset="100%" stopColor="#047857" />
        </LinearGradient>
        <RadialGradient id="wg-glow" cx="65%" cy="42%" r="42%">
          <Stop offset="0%" stopColor="#34d399" stopOpacity="0.2" />
          <Stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#wg-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#wg-glow)" />
      {/* Linhas de velocidade diagonais */}
      <Line x1="-10" y1="22"  x2="340" y2="-14" stroke="white" strokeWidth="22" opacity="0.04" />
      <Line x1="-10" y1="68"  x2="340" y2="32"  stroke="white" strokeWidth="15" opacity="0.035" />
      <Line x1="-10" y1="108" x2="340" y2="72"  stroke="white" strokeWidth="10" opacity="0.028" />
      {/* Haltere fantasma — direita superior */}
      <Circle cx="208" cy="55" r="27" fill="white" opacity="0.08" />
      <Circle cx="208" cy="55" r="17" fill="white" opacity="0.05" />
      <Rect x="235" y="49" width="30" height="12" rx="3" fill="white" opacity="0.06" />
      <Circle cx="291" cy="55" r="27" fill="white" opacity="0.08" />
      <Circle cx="291" cy="55" r="17" fill="white" opacity="0.05" />
      {/* Anel decorativo canto */}
      <Circle cx="295" cy="6"  r="58" stroke="white" strokeWidth="1.5" fill="none" opacity="0.06" />
      <Circle cx="295" cy="6"  r="38" stroke="white" strokeWidth="1"   fill="none" opacity="0.04" />
      <BottomFade id="wg-fade" />
    </>
  );
}

// ── Treino Online ─────────────────────────────────────────────────────────────
function ArtWorkoutOnline() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="wo-bg" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0%" stopColor="#0c2461" />
          <Stop offset="100%" stopColor="#1941a0" />
        </LinearGradient>
        <RadialGradient id="wo-glow" cx="65%" cy="38%" r="42%">
          <Stop offset="0%" stopColor="#60a5fa" stopOpacity="0.3" />
          <Stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#wo-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#wo-glow)" />
      {/* Tela de monitor (retângulo arredondado) */}
      <Rect x="168" y="12" width="110" height="78" rx="8" stroke="white" strokeWidth="1.5" fill="white" fillOpacity="0.06" opacity="0.6" />
      {/* Scan lines dentro do monitor */}
      {[22, 30, 38, 46, 54, 62, 70, 78].map((y, i) => (
        <Line key={i} x1="174" y1={y} x2="272" y2={y} stroke="white" strokeWidth="1" opacity={(0.14 - i * 0.012)} />
      ))}
      {/* Base do monitor */}
      <Rect x="213" y="90"  width="20" height="10" rx="2" fill="white" opacity="0.08" />
      <Rect x="202" y="100" width="42" height="5"  rx="2" fill="white" opacity="0.07" />
      {/* Sinal WiFi (arcos concêntricos) */}
      <Circle cx="94" cy="62" r="8"  stroke="white" strokeWidth="2" fill="none" opacity="0.20" />
      <Circle cx="94" cy="62" r="20" stroke="white" strokeWidth="1.5" fill="none" opacity="0.13" />
      <Circle cx="94" cy="62" r="32" stroke="white" strokeWidth="1" fill="none" opacity="0.07" />
      <Circle cx="94" cy="62" r="4"  fill="white" opacity="0.22" />
      {/* Pontinhos de cursor/dados */}
      <Circle cx="46"  cy="30" r="2.5" fill="white" opacity="0.15" />
      <Circle cx="130" cy="24" r="2"   fill="white" opacity="0.12" />
      <Circle cx="55"  cy="105" r="2"  fill="white" opacity="0.10" />
      <BottomFade id="wo-fade" />
    </>
  );
}

// ── Subiu de Nível ────────────────────────────────────────────────────────────
function ArtLevelUp() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="lu-bg" x1="0.2" y1="1" x2="0.8" y2="0">
          <Stop offset="0%" stopColor="#0f172a" />
          <Stop offset="100%" stopColor="#1e3a8a" />
        </LinearGradient>
        <RadialGradient id="lu-glow" cx="60%" cy="40%" r="40%">
          <Stop offset="0%" stopColor="#3b82f6" stopOpacity="0.32" />
          <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#lu-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#lu-glow)" />
      {/* Seta apontando para cima */}
      <Polygon
        points="190,10 218,54 202,54 202,108 178,108 178,54 162,54"
        fill="white" opacity="0.09"
      />
      {/* Linhas horizontais de "nível" */}
      <Line x1="22" y1="46" x2="130" y2="46" stroke="white" strokeWidth="1.2" opacity="0.13" strokeDasharray="5,4" />
      <Line x1="22" y1="66" x2="112" y2="66" stroke="white" strokeWidth="1"   opacity="0.09" strokeDasharray="5,4" />
      <Line x1="22" y1="86" x2="122" y2="86" stroke="white" strokeWidth="0.8" opacity="0.07" strokeDasharray="5,4" />
      {/* Estrelas de 4 pontas */}
      <Polygon points={star4Points(40,  22, 5.5, 2.4)} fill="white" opacity="0.18" />
      <Polygon points={star4Points(278, 18, 4.5, 2.0)} fill="white" opacity="0.14" />
      <Polygon points={star4Points(68,  112, 3.5, 1.5)} fill="white" opacity="0.10" />
      <Polygon points={star4Points(292, 96,  3.0, 1.3)} fill="white" opacity="0.08" />
      <Polygon points={star4Points(158, 14,  3.0, 1.2)} fill="white" opacity="0.12" />
      <Circle cx="190" cy="56" r="50" fill="white" opacity="0.022" />
      <BottomFade id="lu-fade" />
    </>
  );
}

// ── Marco de Sequência ────────────────────────────────────────────────────────
function ArtStreak() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="sm-bg" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0%" stopColor="#c2410c" />
          <Stop offset="100%" stopColor="#7c2d12" />
        </LinearGradient>
        <RadialGradient id="sm-glow" cx="62%" cy="44%" r="44%">
          <Stop offset="0%" stopColor="#fb923c" stopOpacity="0.42" />
          <Stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#sm-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#sm-glow)" />
      {/* Chama principal */}
      <Ellipse cx="208" cy="76"  rx="38" ry="58" fill="white" opacity="0.06" />
      <Ellipse cx="208" cy="84"  rx="24" ry="40" fill="white" opacity="0.07" />
      <Ellipse cx="208" cy="92"  rx="14" ry="26" fill="white" opacity="0.09" />
      <Ellipse cx="208" cy="40"  rx="10" ry="20" fill="white" opacity="0.05" />
      {/* Brasas voadoras */}
      <Circle cx="160" cy="30"  r="3.5" fill="white" opacity="0.17" />
      <Circle cx="248" cy="20"  r="2.5" fill="white" opacity="0.14" />
      <Circle cx="272" cy="58"  r="3"   fill="white" opacity="0.11" />
      <Circle cx="148" cy="80"  r="2"   fill="white" opacity="0.09" />
      <Circle cx="264" cy="108" r="3"   fill="white" opacity="0.08" />
      <Circle cx="178" cy="14"  r="2"   fill="white" opacity="0.14" />
      <Circle cx="232" cy="16"  r="1.5" fill="white" opacity="0.10" />
      {/* Auras de calor */}
      <Circle cx="208" cy="68" r="64" stroke="white" strokeWidth="1.2" fill="none" opacity="0.05" />
      <Circle cx="208" cy="68" r="82" stroke="white" strokeWidth="0.8" fill="none" opacity="0.03" />
      <BottomFade id="sm-fade" />
    </>
  );
}

// ── Ranking: 1° Lugar — Ouro ──────────────────────────────────────────────────
// Visual: coroa dominante, raios de luz, estrelas premium, fundo dourado rico
function ArtRanking1st() {
  // Coroa centrada em (195, 54), ponta mais alta em y=28
  const crownPoints = [
    "164,82", "164,72", "164,58",
    "174,42", "185,62",
    "195,24",  // pico central — mais alto
    "205,62", "216,42",
    "226,58", "226,72", "226,82",
  ].join(" ");

  return (
    <>
      <SvgDefs>
        <LinearGradient id="r1-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#3f1700" />
          <Stop offset="100%" stopColor="#a16207" />
        </LinearGradient>
        <RadialGradient id="r1-glow" cx="60%" cy="40%" r="48%">
          <Stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
          <Stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#r1-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#r1-glow)" />
      {/* Raios triangulares a partir do centro da coroa */}
      <Rays cx={195} cy={53} innerR={38} outerR={96} count={10} opacity={0.07} spreadDeg={5} />
      {/* Coroa principal */}
      <Polygon points={crownPoints} fill="white" opacity="0.15" />
      {/* Faixa da base da coroa */}
      <Rect x="164" y="70" width="62" height="12" rx="3" fill="white" opacity="0.11" />
      {/* Joias nos picos da coroa */}
      <Circle cx="174" cy="42" r="4" fill="white" opacity="0.18" />
      <Circle cx="195" cy="24" r="5" fill="white" opacity="0.20" />
      <Circle cx="216" cy="42" r="4" fill="white" opacity="0.18" />
      {/* Estrelas de 5 pontas */}
      <Polygon points={starPoints(56,  24, 7, 3)}   fill="white" opacity="0.20" />
      <Polygon points={starPoints(56,  24, 7, 3)}   fill="white" opacity="0.20" />
      <Polygon points={starPoints(284, 18, 6, 2.5)} fill="white" opacity="0.16" />
      <Polygon points={starPoints(50,  95, 4.5, 2)} fill="white" opacity="0.12" />
      <Polygon points={starPoints(298, 88, 5, 2.2)} fill="white" opacity="0.11" />
      <Polygon points={starPoints(134, 14, 3.5, 1.5)} fill="white" opacity="0.14" />
      {/* Halo ao redor da coroa */}
      <Circle cx="195" cy="53" r="52" stroke="white" strokeWidth="1" fill="none" opacity="0.08" />
      <BottomFade id="r1-fade" />
    </>
  );
}

// ── Ranking: 2° Lugar — Prata ─────────────────────────────────────────────────
// Visual: medalha circular proeminente, linhas metálicas, tons de aço
function ArtRanking2nd() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="r2-bg" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0%" stopColor="#0f1b2d" />
          <Stop offset="100%" stopColor="#1e3a5f" />
        </LinearGradient>
        <RadialGradient id="r2-glow" cx="60%" cy="40%" r="44%">
          <Stop offset="0%" stopColor="#94a3b8" stopOpacity="0.40" />
          <Stop offset="100%" stopColor="#94a3b8" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#r2-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#r2-glow)" />
      {/* Medalha circular */}
      <Circle cx="195" cy="50" r="40" stroke="white" strokeWidth="2.5" fill="none" opacity="0.16" />
      <Circle cx="195" cy="50" r="30" stroke="white" strokeWidth="1.5" fill="none" opacity="0.10" />
      <Circle cx="195" cy="50" r="20" fill="white" opacity="0.08" />
      {/* Número "2" implícito via dois arcos horizontais */}
      <Line x1="181" y1="41" x2="209" y2="41" stroke="white" strokeWidth="3" strokeLinecap="round" opacity="0.20" />
      <Line x1="181" y1="57" x2="209" y2="57" stroke="white" strokeWidth="3" strokeLinecap="round" opacity="0.16" />
      {/* Fita da medalha */}
      <Line x1="189" y1="8"  x2="189" y2="26" stroke="white" strokeWidth="4" strokeLinecap="round" opacity="0.14" />
      <Line x1="201" y1="8"  x2="201" y2="26" stroke="white" strokeWidth="4" strokeLinecap="round" opacity="0.14" />
      <Rect x="186" y="6" width="18" height="5" rx="2" fill="white" opacity="0.12" />
      {/* Riscas metálicas diagonais (textura de metal) */}
      <Line x1="140" y1="0"  x2="200" y2="140" stroke="white" strokeWidth="18" opacity="0.03" />
      <Line x1="170" y1="0"  x2="230" y2="140" stroke="white" strokeWidth="12" opacity="0.025" />
      <Line x1="200" y1="0"  x2="260" y2="140" stroke="white" strokeWidth="8"  opacity="0.02" />
      {/* Estrelas menores (tom prata) */}
      <Polygon points={star4Points(52,  26, 5, 2.2)} fill="white" opacity="0.16" />
      <Polygon points={star4Points(282, 22, 4, 1.8)} fill="white" opacity="0.12" />
      <Polygon points={star4Points(62,  108, 3, 1.3)} fill="white" opacity="0.09" />
      <Polygon points={star4Points(292, 102, 3.5, 1.5)} fill="white" opacity="0.08" />
      {/* Halo externo */}
      <Circle cx="195" cy="50" r="58" stroke="white" strokeWidth="0.8" fill="none" opacity="0.06" />
      <BottomFade id="r2-fade" />
    </>
  );
}

// ── Ranking: 3° Lugar — Bronze ────────────────────────────────────────────────
// Visual: pódio com degrau 3 em destaque, laço/fita, tons bronze-cobre
function ArtRanking3rd() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="r3-bg" x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0%" stopColor="#3a0e02" />
          <Stop offset="100%" stopColor="#7c3d0a" />
        </LinearGradient>
        <RadialGradient id="r3-glow" cx="62%" cy="44%" r="44%">
          <Stop offset="0%" stopColor="#d97706" stopOpacity="0.30" />
          <Stop offset="100%" stopColor="#d97706" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#r3-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#r3-glow)" />
      {/* Pódio — 3 degraus, o 3° (à direita) em destaque ligeiro */}
      <Rect x="112" y="62" width="50" height="64" rx="4" fill="white" opacity="0.09" />
      <Rect x="52"  y="82" width="44" height="44" rx="4" fill="white" opacity="0.06" />
      {/* 3° lugar em destaque (mais brilhante) */}
      <Rect x="178" y="92" width="50" height="34" rx="4" fill="white" opacity="0.13" />
      {/* Laço/fita acima do pódio 3° */}
      {/* Círculo superior do laço */}
      <Circle cx="202" cy="70" r="15" stroke="white" strokeWidth="2" fill="none" opacity="0.15" />
      <Circle cx="202" cy="70" r="8"  fill="white" opacity="0.10" />
      {/* Alças do laço */}
      <Ellipse cx="192" cy="75" rx="10" ry="14" fill="white" opacity="0.08" />
      <Ellipse cx="212" cy="75" rx="10" ry="14" fill="white" opacity="0.08" />
      {/* Pontinhos decorativos */}
      <Circle cx="58"  cy="30"  r="3"   fill="white" opacity="0.15" />
      <Circle cx="274" cy="24"  r="2.5" fill="white" opacity="0.12" />
      <Circle cx="52"  cy="108" r="2"   fill="white" opacity="0.09" />
      <Circle cx="295" cy="90"  r="2.5" fill="white" opacity="0.08" />
      {/* Estrela menor (1 só, bronze é mais modesto) */}
      <Polygon points={starPoints(56, 24, 6, 2.6)} fill="white" opacity="0.16" />
      <Polygon points={starPoints(280, 20, 5, 2.2)} fill="white" opacity="0.11" />
      <BottomFade id="r3-fade" />
    </>
  );
}

// ── Conquista Desbloqueada ────────────────────────────────────────────────────
function ArtAchievement() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="au-bg" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0%" stopColor="#78350f" />
          <Stop offset="100%" stopColor="#451a03" />
        </LinearGradient>
        <RadialGradient id="au-glow" cx="62%" cy="40%" r="44%">
          <Stop offset="0%" stopColor="#d97706" stopOpacity="0.48" />
          <Stop offset="100%" stopColor="#d97706" stopOpacity="0" />
        </RadialGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#au-bg)" />
      <Rect x="0" y="0" width="320" height="140" fill="url(#au-glow)" />
      {/* Starburst: raios triangulares */}
      <Rays cx={200} cy={54} innerR={24} outerR={82} count={8} opacity={0.07} spreadDeg={5} />
      {/* Estrela central de 5 pontas */}
      <Polygon points={starPoints(200, 54, 22, 10)} fill="white" opacity="0.12" />
      {/* Anéis */}
      <Circle cx="200" cy="54" r="56" stroke="white" strokeWidth="1.2" fill="none" opacity="0.06" />
      <Circle cx="200" cy="54" r="38" stroke="white" strokeWidth="0.8" fill="none" opacity="0.05" />
      {/* Decorativos */}
      <Circle cx="104" cy="36"  r="3.5" fill="white" opacity="0.14" />
      <Circle cx="294" cy="50"  r="2.5" fill="white" opacity="0.10" />
      <Circle cx="112" cy="108" r="2"   fill="white" opacity="0.08" />
      <Polygon points={starPoints(284, 26, 5, 2.2)} fill="white" opacity="0.12" />
      <BottomFade id="au-fade" />
    </>
  );
}

// ── Genérico (fallback) ───────────────────────────────────────────────────────
function ArtGeneric() {
  return (
    <>
      <SvgDefs>
        <LinearGradient id="gn-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#14532d" />
          <Stop offset="100%" stopColor="#15803d" />
        </LinearGradient>
      </SvgDefs>
      <Rect x="0" y="0" width="320" height="140" fill="url(#gn-bg)" />
      {[30, 80, 130, 180, 230, 280].map((cx, i) => (
        <Circle key={i} cx={cx} cy={i % 2 === 0 ? 38 : 90} r={4} fill="white" opacity="0.07" />
      ))}
      <BottomFade id="gn-fade" />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SELEÇÃO DE ARTE E OVERLAY DE TEXTO
// ══════════════════════════════════════════════════════════════════════════════

function svgArtForType(type: string, meta: Record<string, unknown>) {
  if (type === "WORKOUT_COMPLETED") {
    return meta.type === "ONLINE" ? <ArtWorkoutOnline /> : <ArtWorkoutGym />;
  }
  if (type === "LEVEL_UP")           return <ArtLevelUp />;
  if (type === "STREAK_MILESTONE")   return <ArtStreak />;
  if (type === "ACHIEVEMENT_UNLOCKED") return <ArtAchievement />;
  if (type.startsWith("RANKING_")) {
    const position = meta.position as number | undefined;
    if (position === 1) return <ArtRanking1st />;
    if (position === 2) return <ArtRanking2nd />;
    return <ArtRanking3rd />;
  }
  return <ArtGeneric />;
}

function resolveOverlay(post: FeedPost) {
  const meta = (post.metadata ?? {}) as FeedPostMetadata & Record<string, unknown>;
  const type = post.type;

  if (type === "WORKOUT_COMPLETED") {
    const isOnline = meta.type === "ONLINE";
    return {
      icon: isOnline ? ("wifi" as const) : ("barbell" as const),
      headline: isOnline ? "Treino online concluído" : "Aula presencial concluída",
      detail: meta.providerName ? `com ${meta.providerName as string}` : undefined,
    };
  }
  if (type === "LEVEL_UP") {
    const lvl = meta.newLevel as number | undefined;
    const name = meta.levelName as string | undefined;
    return {
      icon: "flash" as const,
      headline: lvl && name ? `Nível ${lvl} — ${name}` : "Novo nível alcançado!",
      detail: meta.totalXp ? `${meta.totalXp} XP acumulados` : undefined,
    };
  }
  if (type === "STREAK_MILESTONE") {
    const sessions = meta.sessions as number | undefined;
    return {
      icon: "flame" as const,
      headline: sessions ? `${sessions} treinos seguidos!` : "Marco de sequência!",
      detail: "Sequência incrível de dedicação",
    };
  }
  if (type === "ACHIEVEMENT_UNLOCKED") {
    return {
      icon: "ribbon" as const,
      headline: (meta.achievementName as string | undefined) ?? "Conquista desbloqueada!",
      detail: meta.achievementDescription as string | undefined,
    };
  }
  if (type.startsWith("RANKING_")) {
    const position = meta.position as number | undefined;
    const posLabel =
      position === 1 ? "Campeão da semana!" :
      position === 2 ? "2° lugar — muito perto!" :
      "3° lugar — pódio garantido!";
    const isWeekly = type.includes("WEEK");
    const isEntered = type.includes("ENTERED");
    const scope = isWeekly ? "semanal" : "mensal";
    return {
      icon: position === 1 ? ("trophy" as const) : ("podium" as const),
      headline: position ? posLabel : "Top 3!",
      detail: `${isEntered ? "Entrou no" : "Encerrou no"} top 3 ${scope}${meta.xpEarned ? ` · +${meta.xpEarned} XP` : ""}`,
    };
  }
  return { icon: "sparkles" as const, headline: "Momento incrível!", detail: undefined };
}

// ── Componente principal ──────────────────────────────────────────────────────
interface Props {
  post: FeedPost;
}

export function FeedPostArtSvg({ post }: Props) {
  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const { icon, headline, detail } = resolveOverlay(post);

  return (
    <View style={{ borderRadius: 12, overflow: "hidden", height: 148 }}>
      <Svg width="100%" height="148" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice">
        {svgArtForType(post.type, meta)}
      </Svg>
      <View
        style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12,
        }}
      >
        <View
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            backgroundColor: "rgba(0,0,0,0.35)",
            borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={18} color="rgba(255,255,255,0.92)" />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: "DMSans_700Bold", fontSize: 14, color: "#fff", lineHeight: 20,
              textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
            }}
            numberOfLines={2}
          >
            {headline}
          </Text>
          {detail ? (
            <Text
              style={{
                fontFamily: "DMSans_400Regular", fontSize: 11,
                color: "rgba(255,255,255,0.72)", marginTop: 2,
                textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
              }}
              numberOfLines={1}
            >
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
