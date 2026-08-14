import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { resolveMediaUrl } from "../../utils/media";
import { DISPLAY } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

// V2: tons alinhados ao design system (green, amber, blue/sky).
// Os tons legados (purple, red, teal) são mapeados para os mais próximos do V2.
export type AvatarTone = "green" | "amber" | "blue" | "purple" | "red" | "teal";

// Tamanhos padronizados conforme o protótipo V2
export type AvatarSize = "sm" | "md" | "lg" | number;

interface MvAvatarProps {
  initials: string;
  // tone substitui "color" para alinhar com a nomenclatura do protótipo V2
  tone?: AvatarTone;
  /** @deprecated use tone */
  color?: AvatarTone;
  size?: AvatarSize;
  borderRadius?: number;
  photoUri?: string | null;
  /** Capa verde ao redor da miniatura (liga por padrão — ver protótipo aprovado). */
  aura?: boolean;
  /**
   * Frente 15 (segunda camada, acessibilidade), Lote 4: sem isso, o leitor
   * de tela anunciava cada avatar só como "imagem" — numa lista (chat,
   * seguidores), várias entradas ficavam indistinguíveis. Quando não
   * passado, o avatar vira decorativo (accessible={false}) em vez de
   * "imagem" mudo — correto pro caso comum onde o nome já aparece como
   * texto ao lado (duplicar seria ruído), mas quem for o único
   * identificador visível numa tela deve passar o nome aqui.
   */
  accessibilityLabel?: string;
}

const SIZE_MAP: Record<string, number> = { sm: 36, md: 46, lg: 56 };

// Capa: degradê verde -> cor de fundo do tema, "aceso" a 200° (medido a
// partir do topo, sentido horário) — traduzido pras coordenadas 0-1 que o
// LinearGradient usa (aproximação linear do conic-gradient do protótipo).
const AURA_START = { x: 0.33, y: 0.97 };
const AURA_END = { x: 0.67, y: 0.03 };

function resolveSize(size: AvatarSize): number {
  if (typeof size === "number") return Math.max(16, Math.min(200, size));
  return SIZE_MAP[size] ?? 46;
}

// Espessura da capa proporcional ao tamanho do avatar (~7.5%), pra ficar
// "fina" em qualquer tamanho — 4px no tamanho testado/aprovado (56px).
function resolveAuraThickness(dim: number): number {
  return Math.max(2, Math.min(6, Math.round(dim * 0.075)));
}

// Gradientes V2: fundo escuro com overlay colorido translúcido
const GRADIENTS: Record<string, [string, string]> = {
  green:  ["rgba(36,230,109,0.28)",  "rgba(4,40,18,0.85)"],
  amber:  ["rgba(245,166,35,0.28)",  "rgba(120,60,0,0.85)"],
  blue:   ["rgba(56,189,248,0.28)",  "rgba(7,50,100,0.85)"],
  // legados mapeados
  purple: ["rgba(171,71,188,0.28)",  "rgba(60,10,80,0.85)"],
  red:    ["rgba(239,68,68,0.28)",   "rgba(80,10,10,0.85)"],
  teal:   ["rgba(20,184,166,0.28)",  "rgba(4,40,36,0.85)"],
};

const TEXT_COLORS: Record<string, string> = {
  green:  "#FFFFFF",
  amber:  "#FFFFFF",
  blue:   "#FFFFFF",
  purple: "#FFFFFF",
  red:    "#FFFFFF",
  teal:   "#FFFFFF",
};

export function MvAvatar({
  initials,
  tone,
  color,
  size = "md",
  borderRadius,
  photoUri,
  aura = true,
  accessibilityLabel,
}: MvAvatarProps) {
  const { theme } = useMvTheme();
  const resolvedTone: AvatarTone = tone ?? color ?? "green";
  const resolvedPhotoUri = resolveMediaUrl(photoUri);
  const dim = resolveSize(size);
  const br = borderRadius ?? dim / 2;
  const fontSize = Math.round(dim * 0.34);
  const [photoError, setPhotoError] = useState(false);

  let content: React.ReactNode;

  if (resolvedPhotoUri && !photoError) {
    // Frente 11 (engenharia mobile), Lote 11: expo-image (em vez do Image
    // nativo) — cache persistente em disco por padrão (cachePolicy
    // "memory-disk"), então o avatar de um usuário já visto não baixa de
    // novo a cada montagem/lista nova, só a cada troca real de foto (a URL
    // muda quando a foto é trocada, invalidando o cache naturalmente).
    content = (
      <Image
        source={{ uri: resolvedPhotoUri }}
        style={{ width: dim, height: dim, borderRadius: br }}
        contentFit="cover"
        cachePolicy="memory-disk"
        onError={() => setPhotoError(true)}
        accessible={Boolean(accessibilityLabel)}
        accessibilityLabel={accessibilityLabel}
      />
    );
  } else {
    const [from, to] = GRADIENTS[resolvedTone] ?? GRADIENTS.green;
    content = (
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0.35, y: 0.2 }}
        end={{ x: 1, y: 1 }}
        accessible={Boolean(accessibilityLabel)}
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.base,
          {
            width: dim,
            height: dim,
            borderRadius: br,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.38,
            shadowRadius: 12,
            elevation: 6,
          },
        ]}
      >
        {/* overlay de destaque no canto superior esquerdo */}
        <View style={[styles.highlight, { borderRadius: br }]} />
        <Text
          style={{
            fontFamily: DISPLAY,
            fontWeight: "800",
            fontSize,
            color: TEXT_COLORS[resolvedTone] ?? "#FFF",
            letterSpacing: -0.02 * fontSize,
          }}
          numberOfLines={1}
        >
          {(initials ?? "").trim().toUpperCase().slice(0, 2) || "?"}
        </Text>
      </LinearGradient>
    );
  }

  if (!aura) {
    return content;
  }

  const thickness = resolveAuraThickness(dim);
  const outerDim = dim + thickness * 2;

  return (
    <LinearGradient
      colors={[theme.textGreen, theme.bg]}
      start={AURA_START}
      end={AURA_END}
      style={{
        width: outerDim,
        height: outerDim,
        borderRadius: outerDim / 2,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        shadowColor: theme.textGreen,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      {content}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.10)",
    // cobre apenas o quadrante superior-esquerdo para simular radial gradient
    borderBottomRightRadius: 9999,
    width: "55%",
    height: "55%",
  },
});
