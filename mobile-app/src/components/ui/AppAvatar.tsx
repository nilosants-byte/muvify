import React, { useState } from "react";
import { Image, View } from "react-native";
import { AppText } from "./AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type AvatarSize = "sm" | "md" | "lg";

interface AppAvatarProps {
  uri?: string | null;
  initials?: string;
  size?: AvatarSize;
}

const sizeMap: Record<AvatarSize, number> = {
  sm: 40,
  md: 52,
  lg: 72,
};

export function AppAvatar({ uri, initials, size = "md" }: AppAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const dimension = sizeMap[size];
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    image: {
      backgroundColor: palette.surfaceElevated,
    },
    fallback: {
      backgroundColor: palette.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
    },
  }));
  const commonStyle = {
    width: dimension,
    height: dimension,
    borderRadius: dimension / 2,
    borderWidth: 1,
    borderColor: colors.border,
  };

  if (uri && !imageError) {
    return (
      <Image
        accessibilityLabel="Foto de perfil"
        accessibilityRole="image"
        source={{ uri }}
        style={[styles.image, commonStyle]}
        resizeMode="cover"
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <View style={[styles.fallback, commonStyle]}>
      <AppText variant="captionStrong">{initials ?? "--"}</AppText>
    </View>
  );
}
