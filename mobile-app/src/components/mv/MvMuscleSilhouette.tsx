import React from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, Rect } from "react-native-svg";
import { useMvTheme } from "../../theme/MvThemeContext";

// Feature experimental (decisão do usuário, 2026-08-19): tentativa nova, sem
// garantia de que vai ficar boa visualmente. Por isso este componente não
// depende de nada além de `category` — nenhum acoplamento a
// TrainingPlanExercise/telas. Pra remover a feature depois, basta remover o
// slot que renderiza <MvMuscleSilhouette /> em quem o usa; nada mais no app
// depende deste arquivo.
//
// v1 pragmática: silhueta geométrica única (vista frontal simplificada) com
// os 10 grupos musculares isolados mapeáveis das EXERCISE_CATEGORIES
// (mobile-app/src/services/api/client.ts) aproximados nela — inclusive os
// que anatomicamente ficariam melhor numa vista posterior (Dorsal,
// Posterior, Glúteos). "Membros Superiores"/"Membros Inferiores" (exercícios
// compostos, sem músculo isolado) destacam várias regiões de uma vez em vez
// de uma só. As categorias sem músculo específico (Alongamento, Mobilidade,
// Cardio) fazem o componente retornar null.

type MuscleRegion =
  | "Peitoral"
  | "Ombros"
  | "Tríceps"
  | "Bíceps"
  | "Dorsal"
  | "Posterior"
  | "Glúteos"
  | "Quadríceps"
  | "Panturrilha"
  | "Abdômen";

// Categoria (como vem de EXERCISE_CATEGORIES) -> região(ões) destacada(s).
// Categorias de músculo isolado destacam só a própria região; "Membros
// Superiores"/"Membros Inferiores" destacam várias de uma vez.
const CATEGORY_REGIONS: Readonly<Record<string, readonly MuscleRegion[]>> = {
  "Peitoral": ["Peitoral"],
  "Ombros": ["Ombros"],
  "Tríceps": ["Tríceps"],
  "Bíceps": ["Bíceps"],
  "Dorsal": ["Dorsal"],
  "Posterior": ["Posterior"],
  "Glúteos": ["Glúteos"],
  "Quadríceps": ["Quadríceps"],
  "Panturrilha": ["Panturrilha"],
  "Abdômen": ["Abdômen"],
  "Membros Superiores": ["Ombros", "Bíceps", "Tríceps"],
  "Membros Inferiores": ["Glúteos", "Quadríceps", "Posterior", "Panturrilha"],
};

type Props = {
  category: string | null | undefined;
  size?: number;
};

export function MvMuscleSilhouette({ category, size = 48 }: Props) {
  const { theme } = useMvTheme();

  const activeRegions = category ? CATEGORY_REGIONS[category] : undefined;
  if (!activeRegions) {
    return null;
  }

  const highlight = theme.primary;
  const base = theme.mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";
  const baseStroke = theme.mode === "dark" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.16)";

  function fillFor(region: MuscleRegion) {
    return activeRegions!.includes(region) ? highlight : base;
  }

  return (
    <View
      style={{
        width: size,
        height: size * 1.6,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size * 1.6} viewBox="0 0 100 160">
        {/* Cabeça e pescoço — nunca destacados */}
        <Circle cx={50} cy={12} r={9} fill={base} stroke={baseStroke} strokeWidth={0.5} />
        <Rect x={46} y={19} width={8} height={7} rx={2} fill={base} />

        {/* Ombros */}
        <Ellipse cx={28} cy={30} rx={9} ry={6.5} fill={fillFor("Ombros")} />
        <Ellipse cx={72} cy={30} rx={9} ry={6.5} fill={fillFor("Ombros")} />

        {/* Dorsal (aproximado: faixas laterais do tronco, sob os ombros) */}
        <Rect x={25} y={29} width={8} height={26} rx={4} fill={fillFor("Dorsal")} />
        <Rect x={67} y={29} width={8} height={26} rx={4} fill={fillFor("Dorsal")} />

        {/* Peitoral */}
        <Rect x={34} y={27} width={32} height={20} rx={8} fill={fillFor("Peitoral")} />

        {/* Abdômen */}
        <Rect x={37} y={48} width={26} height={19} rx={6} fill={fillFor("Abdômen")} />

        {/* Braços: tríceps (tira externa) + bíceps (tira interna) */}
        <Rect x={9} y={33} width={6} height={22} rx={3} fill={fillFor("Tríceps")} />
        <Rect x={85} y={33} width={6} height={22} rx={3} fill={fillFor("Tríceps")} />
        <Rect x={16} y={31} width={8} height={24} rx={4} fill={fillFor("Bíceps")} />
        <Rect x={76} y={31} width={8} height={24} rx={4} fill={fillFor("Bíceps")} />
        {/* Antebraço — nunca destacado */}
        <Rect x={13} y={55} width={8} height={20} rx={3} fill={base} />
        <Rect x={79} y={55} width={8} height={20} rx={3} fill={base} />

        {/* Glúteos / quadril */}
        <Rect x={38} y={67} width={24} height={10} rx={5} fill={fillFor("Glúteos")} />

        {/* Coxas: quadríceps (miolo) + posterior (tiras externas, aproximado) */}
        <Rect x={29} y={80} width={5} height={26} rx={2.5} fill={fillFor("Posterior")} />
        <Rect x={66} y={80} width={5} height={26} rx={2.5} fill={fillFor("Posterior")} />
        <Rect x={33} y={78} width={14} height={30} rx={6} fill={fillFor("Quadríceps")} />
        <Rect x={53} y={78} width={14} height={30} rx={6} fill={fillFor("Quadríceps")} />

        {/* Panturrilha */}
        <Rect x={33} y={113} width={11} height={25} rx={5} fill={fillFor("Panturrilha")} />
        <Rect x={56} y={113} width={11} height={25} rx={5} fill={fillFor("Panturrilha")} />

        {/* Pés — nunca destacados */}
        <Ellipse cx={38} cy={150} rx={6} ry={4} fill={base} />
        <Ellipse cx={62} cy={150} rx={6} ry={4} fill={base} />
      </Svg>
    </View>
  );
}
