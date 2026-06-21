import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { resolveMediaUrl } from "../../utils/media";
import { DISPLAY } from "../../theme/v2tokens";

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
}

const SIZE_MAP: Record<string, number> = { sm: 36, md: 46, lg: 56 };

function resolveSize(size: AvatarSize): number {
  if (typeof size === "number") return Math.max(16, Math.min(200, size));
  return SIZE_MAP[size] ?? 46;
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
}: MvAvatarProps) {
  const resolvedTone: AvatarTone = tone ?? color ?? "green";
  const resolvedPhotoUri = resolveMediaUrl(photoUri);
  const dim = resolveSize(size);
  const br = borderRadius ?? dim / 2;
  const fontSize = Math.round(dim * 0.34);
  const [photoError, setPhotoError] = useState(false);

  if (resolvedPhotoUri && !photoError) {
    return (
      <Image
        source={{ uri: resolvedPhotoUri }}
        style={{ width: dim, height: dim, borderRadius: br }}
        resizeMode="cover"
        onError={() => setPhotoError(true)}
      />
    );
  }

  const [from, to] = GRADIENTS[resolvedTone] ?? GRADIENTS.green;

  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0.35, y: 0.2 }}
      end={{ x: 1, y: 1 }}
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
