import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Image, Text } from "react-native";
import { typography } from "../../theme/MvTypography";
import { resolveMediaUrl } from "../../utils/media";

type AvatarColor = "green" | "blue" | "purple" | "red" | "teal";

interface MvAvatarProps {
  initials: string;
  color?: AvatarColor;
  size?: number;
  borderRadius?: number;
  photoUri?: string | null;
}

const gradients: Record<AvatarColor, [string, string]> = {
  green:  ["#16A34A", "#22C55E"],
  blue:   ["#1565C0", "#2563EB"],
  purple: ["#6A1B9A", "#AB47BC"],
  red:    ["#B91C1C", "#EF4444"],
  teal:   ["#00695C", "#14B8A6"],
};

export function MvAvatar({
  initials,
  color = "green",
  size = 40,
  borderRadius,
  photoUri,
}: MvAvatarProps) {
  const resolvedPhotoUri = resolveMediaUrl(photoUri);
  const br = resolvedPhotoUri ? size / 2 : (borderRadius ?? size * 0.28);
  const fontSize = size * 0.38;
  const [from, to] = gradients[color];

  // Track photo load errors — fall back to initials if image fails
  const [photoError, setPhotoError] = useState(false);

  const showPhoto = resolvedPhotoUri && !photoError;

  if (showPhoto) {
    return (
      <Image
        source={{ uri: resolvedPhotoUri, cache: "reload" }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="cover"
        onError={() => setPhotoError(true)}
      />
    );
  }

  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: br,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={[
          typography.h4,
          { color: "#FFFFFF", fontSize, fontFamily: "SpaceGrotesk-Bold" },
        ]}
      >
        {initials.toUpperCase().slice(0, 2)}
      </Text>
    </LinearGradient>
  );
}
