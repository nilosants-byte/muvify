import React, { useEffect, useRef, useState } from "react";
import { Dimensions, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ConfettiCannon from "react-native-confetti-cannon";
import { useMvTheme } from "../../theme/MvThemeContext";
import type { MvTheme } from "../../theme/MvColors";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { hapticAchievement } from "../../utils/haptics";
import type { Achievement } from "../../types/gamification";
import { AchievementBadgeSvg } from "./AchievementBadgeSvg";

export const ACHIEVEMENT_CATEGORY_LABELS: Record<string, string> = {
  PROGRESSION: "Progressão",
  CONSISTENCY: "Consistência",
  VOLUME: "Volume",
  SOCIAL: "Social",
  RANKING: "Ranking",
};
export const ACHIEVEMENT_CATEGORY_ORDER = ["PROGRESSION", "CONSISTENCY", "VOLUME", "SOCIAL", "RANKING"];

export function achAccentColors(tier: Achievement["tier"], theme: MvTheme) {
  if (tier === "gold") return { color: C.amber, dim: C.amberDim, border: C.amberBorder };
  if (tier === "silver") return { color: C.zinc300, dim: "rgba(212,212,216,0.12)" as const, border: "rgba(212,212,216,0.20)" as const };
  if (tier === "diamond") return { color: C.sky, dim: "rgba(56,189,248,0.12)" as const, border: "rgba(56,189,248,0.25)" as const };
  if (tier === "special") return { color: "#a855f7", dim: "rgba(168,85,247,0.12)" as const, border: "rgba(168,85,247,0.25)" as const };
  return { color: theme.primary, dim: theme.primarySubtle, border: theme.primarySubtleBorder };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  achievements: Achievement[];
};

export function AchievementsModal({ visible, onClose, achievements }: Props) {
  const { theme } = useMvTheme();
  const isDark = theme.mode === "dark";
  const insets = useSafeAreaInsets();
  const [celebratingAchievement, setCelebratingAchievement] = useState<Achievement | null>(null);
  const confettiRef = useRef<any>(null);

  useEffect(() => {
    if (celebratingAchievement) {
      const t = setTimeout(() => confettiRef.current?.start(), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [celebratingAchievement]);

  const grouped = ACHIEVEMENT_CATEGORY_ORDER
    .map((cat) => ({ label: ACHIEVEMENT_CATEGORY_LABELS[cat] ?? cat, items: achievements.filter((a) => a.category === cat) }))
    .filter((g) => g.items.length > 0);

  const renderRow = (ach: Achievement) => {
    const { color: accentColor, dim: accentDim, border: accentBorder } = achAccentColors(ach.tier, theme);
    const pct = ach.progress
      ? Math.min(100, Math.round((ach.progress.current / ach.progress.target) * 100))
      : 0;
    return (
      <TouchableOpacity
        key={ach.id}
        onPress={() => {
          if (!ach.unlocked) return;
          onClose();
          setTimeout(() => { void hapticAchievement(); setCelebratingAchievement(ach); }, 300);
        }}
        activeOpacity={ach.unlocked ? 0.7 : 1}
        style={{
          flexDirection: "row", alignItems: "center", gap: 14,
          padding: 14, borderRadius: 16,
          backgroundColor: ach.unlocked ? accentDim : (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"),
          borderWidth: 1, borderColor: ach.unlocked ? accentBorder : theme.border,
          opacity: ach.unlocked ? 1 : 0.6,
        }}
      >
        <AchievementBadgeSvg
          tier={ach.tier}
          icon={ach.icon}
          category={ach.category}
          size={48}
          unlocked={ach.unlocked}
        />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: ach.unlocked ? theme.text1 : theme.labelColor }} numberOfLines={1}>
              {ach.label}
            </Text>
            {ach.unlocked ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: accentDim, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: accentBorder, flexShrink: 0 }}>
                <Ionicons name="checkmark-circle" size={12} color={accentColor} />
                <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: accentColor }}>+{ach.points} XP</Text>
              </View>
            ) : (
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, flexShrink: 0 }}>
                {ach.progress ? `${ach.progress.current}/${ach.progress.target}` : ""}
              </Text>
            )}
          </View>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.text3, lineHeight: 17 }}>
            {ach.requirement}
          </Text>
          {!ach.unlocked && ach.progress && (
            <View style={{ height: 4, borderRadius: 99, backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)", marginTop: 2 }}>
              <View style={{ height: "100%", width: `${pct}%`, borderRadius: 99, backgroundColor: accentColor, opacity: 0.7 }} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" }}
          onPress={onClose}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            backgroundColor: theme.inputBg,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 24,
            maxHeight: "85%",
          }}>
            <View style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: theme.border, alignSelf: "center", marginTop: 12, marginBottom: 8 }} />
            <View style={{ paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 22, color: theme.text1, letterSpacing: -0.3 }}>Conquistas</Text>
              <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3, marginTop: 2 }}>
                {achievements.filter((a) => a.unlocked).length}/{achievements.length} desbloqueadas
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24, gap: 12 }}>
              {grouped.length > 0
                ? grouped.map(({ label, items }) => (
                    <View key={label} style={{ gap: 8 }}>
                      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.text3, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 }}>
                        {label}
                      </Text>
                      {items.map(renderRow)}
                    </View>
                  ))
                : achievements.map(renderRow)}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={celebratingAchievement !== null}
        onRequestClose={() => setCelebratingAchievement(null)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={() => setCelebratingAchievement(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{
            width: "100%", maxWidth: 350,
            backgroundColor: theme.inputBg, borderRadius: 28, padding: 28,
            alignItems: "center", gap: 12,
            borderWidth: 1, borderColor: theme.primarySubtleBorder,
            shadowColor: theme.primary, shadowOpacity: 0.4, shadowRadius: 40, elevation: 12,
          }}>
            {celebratingAchievement && (
              <>
                <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={celebratingAchievement.icon as any} size={36} color={theme.primary} />
                </View>
                <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 26, color: theme.text1, letterSpacing: -0.02 * 26, textAlign: "center" }}>
                  Conquista desbloqueada!
                </Text>
                <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, textAlign: "center", lineHeight: 20 }}>
                  {celebratingAchievement.label} — {celebratingAchievement.description}. Continue assim!
                </Text>
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
                  <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: theme.primary }}>+{celebratingAchievement.points} pts</Text>
                  </View>
                  <View style={{ backgroundColor: C.amberDim, borderWidth: 1, borderColor: C.amberBorder, borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 11, color: C.amber }}>Medalha {celebratingAchievement.tier}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setCelebratingAchievement(null)}
                  style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", width: "100%", marginTop: 8, shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>Incrível!</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>

        <ConfettiCannon
          ref={confettiRef}
          count={120}
          origin={{ x: Dimensions.get("window").width / 2, y: 0 }}
          colors={[theme.primary, C.amber, C.sky, theme.text1]}
          fadeOut
          autoStart={false}
          explosionSpeed={350}
          fallSpeed={3000}
        />
      </Modal>
    </>
  );
}
