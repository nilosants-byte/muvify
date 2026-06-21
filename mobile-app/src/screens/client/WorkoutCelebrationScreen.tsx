import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, Text, View, TouchableOpacity } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ConfettiCannon from "react-native-confetti-cannon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { ClientStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { PressableScale } from "../../components/polish/PressableScale";
import { bookingsApi } from "../../services/api/client";
import { computeUserProgress, computeAchievements } from "../../utils/gamification";
import type { Achievement } from "../../types/gamification";

type Props = NativeStackScreenProps<ClientStackParamList, "WorkoutCelebration">;

const SEEN_ACHIEVEMENTS_KEY = "@muvify/seenAchievements";
const STORE_REVIEW_PROMPTED_KEY = "@muvify/storeReviewPrompted";
const PTS_PRESENCIAL = 80;
const IOS_APP_ID = process.env.EXPO_PUBLIC_IOS_APP_ID ?? "";
const ANDROID_PACKAGE = process.env.EXPO_PUBLIC_ANDROID_PACKAGE ?? "";
const STORE_URL = Platform.OS === "ios"
  ? IOS_APP_ID ? `itms-apps://itunes.apple.com/app/${IOS_APP_ID}` : null
  : ANDROID_PACKAGE ? `market://details?id=${ANDROID_PACKAGE}` : null;

export function WorkoutCelebrationScreen({ route, navigation }: Props) {
  const { bookingId, professionalId, skipReview } = route.params;
  const { runWithAuth } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const confettiRef = useRef<any>(null);

  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);

  useEffect(() => {
    confettiRef.current?.start();

    void (async () => {
      try {
        const bookings = await runWithAuth((token) => bookingsApi.me(token));
        const prog = computeUserProgress(bookings as any);
        const achievs = computeAchievements(prog);

        const seenRaw = await AsyncStorage.getItem(SEEN_ACHIEVEMENTS_KEY);
        const seen: string[] = seenRaw ? (JSON.parse(seenRaw) as string[]) : [];
        const newly = achievs.filter((a) => a.unlocked && !seen.includes(a.id));

        if (newly.length > 0) {
          await AsyncStorage.setItem(
            SEEN_ACHIEVEMENTS_KEY,
            JSON.stringify([...seen, ...newly.map((a) => a.id)])
          );
          setNewAchievements(newly);
        }

        if (prog.totalWorkouts >= 3 && STORE_URL) {
          const alreadyPrompted = await AsyncStorage.getItem(STORE_REVIEW_PROMPTED_KEY);
          if (!alreadyPrompted) {
            await AsyncStorage.setItem(STORE_REVIEW_PROMPTED_KEY, "1");
            Alert.alert(
              "Gostando do Muvify?",
              "Sua opinião nos ajuda a melhorar o app para você e para outros usuários.",
              [
                { text: "Agora não", style: "cancel" },
                { text: "Avaliar", onPress: () => void Linking.openURL(STORE_URL) },
              ]
            );
          }
        }
      } catch { /* best effort */ }
    })();
  }, [runWithAuth]);

  function handleContinue() {
    if (skipReview) {
      navigation.replace("ClientTabs", { screen: "ClientHome" } as any);
    } else {
      navigation.replace("ReviewProfessional", { bookingId, professionalId });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: S.px }}>
      <ConfettiCannon
        ref={confettiRef}
        count={120}
        origin={{ x: -10, y: 0 }}
        autoStart={false}
        fadeOut
        colors={[theme.primary, C.amber, C.sky, "#fff", "#a855f7"]}
        fallSpeed={3000}
        explosionSpeed={350}
      />

      {/* Points badge */}
      <View style={{ alignItems: "center", gap: 6, marginBottom: 32 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.primarySubtle, borderWidth: 2, borderColor: theme.primarySubtleBorder, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
          <Ionicons name="trophy" size={42} color={theme.primary} />
        </View>
        <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 36, color: theme.text1, letterSpacing: -0.02 * 36 }}>
          Treino concluído!
        </Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 16, color: theme.text2 }}>+</Text>
          <AnimatedNumber
            value={PTS_PRESENCIAL}
            duration={900}
            style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 38, color: theme.primary, letterSpacing: -0.013 * 38 }}
          />
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 18, color: theme.primary }}>pts</Text>
        </View>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.text2, textAlign: "center" }}>
          Excelente trabalho! Continue assim.
        </Text>
      </View>

      {/* Newly unlocked achievements */}
      {newAchievements.length > 0 && (
        <View style={{ width: "100%", gap: 10, marginBottom: 32 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.text1, textAlign: "center" }}>
            Conquista{newAchievements.length > 1 ? "s" : ""} desbloqueada{newAchievements.length > 1 ? "s" : ""}!
          </Text>
          {newAchievements.map((a) => {
            const col = a.tier === "bronze" ? C.amber : a.tier === "silver" ? C.sky : theme.primary;
            const bg = a.tier === "bronze" ? C.amberDim : a.tier === "silver" ? C.skyDim : theme.primarySubtle;
            const bd = a.tier === "bronze" ? C.amberBorder : a.tier === "silver" ? C.skyBorder : theme.primarySubtleBorder;
            return (
              <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: S.cardR, padding: 14 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: bg, borderWidth: 1, borderColor: bd, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={a.icon as any} size={18} color={col} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: col }}>{a.label}</Text>
                  <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3 }}>{a.description} · +{a.points} pts</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color={col} />
              </View>
            );
          })}
        </View>
      )}

      {/* Continue button */}
      <View style={{ width: "100%", paddingBottom: Math.max(24, insets.bottom + 12), gap: 10 }}>
        <PressableScale
          onPress={handleContinue}
          accessibilityRole="button"
          style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
            {skipReview ? "Continuar" : "Avaliar personal"}
          </Text>
        </PressableScale>
        <TouchableOpacity
          onPress={() => navigation.replace("ClientTabs", { screen: "ClientHome" } as any)}
          style={{ height: S.touchMin, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text3 }}>Pular avaliação</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
