import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { AppText } from "../ui/AppText";
import { AppLogoText } from "../ui/AppLogoText";
import { theme } from "../../theme";

type BrandLockupProps = {
  compact?: boolean;
  centered?: boolean;
  showSubtitle?: boolean;
};

const LOGO_SIZE_DEFAULT = 28;
const LOGO_SIZE_COMPACT = 22;
const LOGO_SIZE_MAX = 34;

export function BrandLockup({
  compact = false,
  centered = false,
  showSubtitle = true
}: BrandLockupProps) {
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const baseSize = compact ? LOGO_SIZE_COMPACT : LOGO_SIZE_DEFAULT;
  const scaledSize = Math.min(
    LOGO_SIZE_MAX,
    Math.max(baseSize, screenWidth * (compact ? 0.05 : 0.065)),
  );
  const subtitleMarginTop = Math.round(theme.spacing.xs * Math.min(fontScale, 1.3));

  return (
    <View
      style={[
        styles.container,
        centered ? styles.containerCentered : styles.containerLeft,
      ]}
    >
      <AppLogoText size={scaledSize} />
      {showSubtitle ? (
        <AppText
          align={centered ? "center" : "left"}
          style={[styles.subtitle, { marginTop: subtitleMarginTop }]}
          variant="caption"
        >
          Seu ecossistema de treinos
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  containerLeft: {
    alignItems: "flex-start",
  },
  containerCentered: {
    alignItems: "center",
  },
  subtitle: {
  },
});
