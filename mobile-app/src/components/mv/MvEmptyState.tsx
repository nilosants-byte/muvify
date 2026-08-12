import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "./MvText";
import { PressableScale } from "../polish/PressableScale";

// Frente 10 (segunda camada), Lote 12: generaliza o padrão já usado bem em
// ProfessionalStudentsScreen/FavoritesScreen (ícone em círculo + título +
// descrição + CTA opcional), que cada tela reimplementava do zero com
// pequenas divergências visuais.
export function MvEmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaIcon,
  onCtaPress,
  tone = "primary",
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title?: string;
  description: string;
  ctaLabel?: string;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  onCtaPress?: () => void;
  tone?: "primary" | "green";
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useMvTheme();
  const accentColor = tone === "green" ? theme.textGreen : theme.primary;
  const iconBg = tone === "green" ? theme.primarySubtle : theme.primarySubtle;
  const iconBorder = tone === "green" ? theme.primarySubtleBorder : theme.primarySubtleBorder;

  return (
    <View style={[{ alignItems: "center", padding: 32, gap: 14 }, style]}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: iconBorder,
        }}
      >
        <Ionicons name={icon} size={34} color={accentColor} />
      </View>
      <View style={{ alignItems: "center", gap: 6 }}>
        {title ? (
          <MvText variant="h3" style={{ letterSpacing: -1, textAlign: "center" }}>
            {title}
          </MvText>
        ) : null}
        <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
          {description}
        </MvText>
      </View>
      {ctaLabel && onCtaPress ? (
        <PressableScale
          scale={0.96}
          onPress={onCtaPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 20,
            paddingVertical: 12,
            borderRadius: 99,
            backgroundColor: accentColor,
          }}
        >
          {ctaIcon ? <Ionicons name={ctaIcon} size={16} color={theme.textOnPrimary} /> : null}
          <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
            {ctaLabel}
          </MvText>
        </PressableScale>
      ) : null}
    </View>
  );
}
