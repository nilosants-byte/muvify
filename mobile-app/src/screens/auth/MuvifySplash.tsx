import React, { useEffect, useRef } from "react";
import { Animated, Easing, StatusBar, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { ThemeMode } from "../../theme/tokens";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Comprimento do caminho ECG (calculado por segmento):
// M0,12 → L24,12 = 24px | L28,3 = √97 ≈ 9.85 | L32,21 = √340 ≈ 18.44 | L36,12 = √97 ≈ 9.85 | L60,12 = 24px
// Total ≈ 86px
const ECG_PATH_LENGTH = 86;

type Props = {
  colorScheme?: ThemeMode;
  onFinish?: () => void;
};

export default function MuvifySplash({ colorScheme = "dark", onFinish }: Props) {
  const isDark = colorScheme !== "light";
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(12)).current;
  const loadingOpacity = useRef(new Animated.Value(0)).current;
  const ecgAnim     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Logo: fade + slide para cima
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, delay: 100, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, delay: 100, useNativeDriver: true }),
    ]).start();

    // Pulso aparece após 600ms
    Animated.sequence([
      Animated.delay(600),
      Animated.timing(loadingOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    // Loop ECG: o valor 0→1 anima o strokeDashoffset de ECG_PATH_LENGTH a -ECG_PATH_LENGTH,
    // fazendo o traço "desenhar" e percorrer da esquerda para a direita em cada ciclo.
    const ecgLoop = Animated.loop(
      Animated.timing(ecgAnim, {
        toValue: 1,
        duration: 2200,
        easing: Easing.bezier(0.4, 0, 0.6, 1),
        useNativeDriver: false, // propriedades SVG não suportam native driver
      })
    );
    ecgLoop.start();

    const timer = setTimeout(() => onFinish?.(), 3200);
    return () => {
      clearTimeout(timer);
      ecgLoop.stop();
    };
  }, [fadeAnim, slideAnim, loadingOpacity, ecgAnim, onFinish]);

  const bg   = isDark ? "#080e08" : "#FAFFFE";
  const muvi = isDark ? "#F0F0F0" : "#111111";
  const tag  = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.38)";
  const strokeColor = isDark ? "#22C55E" : "#16A34A";

  // strokeDashoffset: começa em ECG_PATH_LENGTH (caminho invisível — todo em gap),
  // anima até -ECG_PATH_LENGTH (caminho saiu da área visível pelo lado direito).
  // O resultado visual: o traço ECG "nasce" no início, percorre e some pela direita.
  const strokeDashoffset = ecgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [ECG_PATH_LENGTH, -ECG_PATH_LENGTH],
  });

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={bg} />

      {/* Logo */}
      <Animated.View
        style={[styles.logoGroup, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
      >
        <View style={styles.wordmark}>
          <Text style={[styles.muvi, { color: muvi }]}>muvi</Text>
          <Text style={[styles.fy, { color: "#4CAF50" }]}>fy</Text>
        </View>
        <Text style={[styles.tagline, { color: tag }]}>mova no seu ritmo.</Text>
      </Animated.View>

      {/* Pulso Vital — animação ECG */}
      <Animated.View style={[styles.ecgWrap, { opacity: loadingOpacity }]}>
        <Svg width={80} height={24} viewBox="0 0 80 24">
          <AnimatedPath
            d="M0,12 L24,12 L28,3 L32,21 L36,12 L60,12"
            stroke={strokeColor}
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
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  logoGroup: { alignItems: "center", gap: 3 },
  wordmark:  { flexDirection: "row", alignItems: "baseline" },
  muvi: {
    fontFamily: "Syne-Bold",
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: -1.5,
  },
  fy: {
    fontFamily: "Syne-Bold",
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: -1.5,
  },
  tagline: { fontFamily: "DMSans-Regular", fontSize: 12, letterSpacing: 0.8, marginTop: 2 },
  ecgWrap: { marginTop: 44, alignItems: "center" },
});
