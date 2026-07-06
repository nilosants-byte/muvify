import React, { useEffect, useRef } from "react";
import { Animated, Easing, StatusBar, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ThemeMode } from "../../theme/tokens";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const ECG_PATH_LENGTH = 86;

type Props = {
  colorScheme?: ThemeMode;
  onFinish?: () => void;
};

export default function MuvifySplash({ colorScheme = "dark", onFinish }: Props) {
  const isDark = colorScheme !== "light";
  const fadeAnim       = useRef(new Animated.Value(0)).current;
  const slideAnim      = useRef(new Animated.Value(12)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  const ecgAnim        = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 700, delay: 100, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, delay: 100, useNativeDriver: true }),
    ]).start();

    Animated.sequence([
      Animated.delay(600),
      Animated.timing(loadingOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    const ecgLoop = Animated.loop(
      Animated.timing(ecgAnim, {
        toValue: 1,
        duration: 2200,
        easing: Easing.bezier(0.4, 0, 0.6, 1),
        useNativeDriver: false,
      })
    );
    ecgLoop.start();

    const timer = setTimeout(() => onFinish?.(), 3200);
    return () => {
      clearTimeout(timer);
      ecgLoop.stop();
    };
  }, [fadeAnim, slideAnim, loadingOpacity, ecgAnim, onFinish]);

  // Cores por modo
  const bg          = isDark ? "#030806" : "#FAFFFE";
  const muvi        = isDark ? "#FFFFFF" : "#0A0F0A";   // "muvi": branco/preto
  const green       = isDark ? "#24E66D" : "#16A34A";   // "fy" + "conecte.": verde
  const tagRest     = isDark ? "#FFFFFF" : "#0A0F0A";

  const strokeDashoffset = ecgAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [ECG_PATH_LENGTH, -ECG_PATH_LENGTH],
  });

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={bg} />

      <Animated.View
        style={[styles.logoGroup, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        {/* Wordmark: "muvi" na cor base + "fy" verde */}
        <View style={styles.wordmark}>
          <Text style={[styles.muvi, { color: muvi }]}>muvi</Text>
          <Text style={[styles.fy,   { color: green }]}>fy</Text>
        </View>

        {/* Tagline: "conecte." em verde · "evolua." em cor suave */}
        <View style={styles.taglineRow}>
          <Text style={[styles.tagline, { color: green }]}>conecte.</Text>
          <Text style={[styles.tagline, { color: tagRest }]}> evolua.</Text>
        </View>
      </Animated.View>

      {/* Pulso ECG */}
      <Animated.View style={[styles.ecgWrap, { opacity: loadingOpacity }]}>
        <Svg width={60} height={24} viewBox="0 0 80 24">
          <AnimatedPath
            d="M0,12 L24,12 L28,3 L32,21 L36,12 L60,12"
            stroke={green}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={ECG_PATH_LENGTH}
            strokeDashoffset={strokeDashoffset}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, alignItems: "center", justifyContent: "center" },
  logoGroup:   { alignItems: "center", gap: 2 },
  wordmark:    { flexDirection: "row", alignItems: "baseline" },
  muvi: {
    fontFamily: "Nunito_800ExtraBold",
    fontSize: 48,
    letterSpacing: -1,
  },
  fy: {
    fontFamily: "Nunito_800ExtraBold",
    fontSize: 48,
    letterSpacing: -1,
  },
  taglineRow:  { flexDirection: "row", alignItems: "baseline" },
  tagline: {
    fontFamily: "Nunito_400Regular",
    fontSize: 13,
    letterSpacing: 0.6,
  },
  ecgWrap: { marginTop: 16, alignItems: "center" },
});
