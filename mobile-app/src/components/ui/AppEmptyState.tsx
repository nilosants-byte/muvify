import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/useTheme";
import { AppText } from "./AppText";
import { AppButton } from "./AppButton";

interface AppEmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function AppEmptyState({
  icon = "albums-outline",
  title,
  description,
  ctaLabel,
  onCta,
  style,
}: AppEmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 40,
          paddingHorizontal: 24,
          gap: 12,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.chipBg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>

      <AppText variant="title" style={{ textAlign: "center", color: colors.text }}>
        {title}
      </AppText>

      {description ? (
        <AppText
          variant="body"
          style={{ textAlign: "center", color: colors.textMuted, lineHeight: 20 }}
        >
          {description}
        </AppText>
      ) : null}

      {ctaLabel && onCta ? (
        <AppButton
          variant="primary"
          title={ctaLabel}
          onPress={onCta}
          fullWidth={false}
          style={{ marginTop: 8, minWidth: 180 }}
        />
      ) : null}
    </View>
  );
}
