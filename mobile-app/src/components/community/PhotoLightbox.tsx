import React, { useEffect } from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  uri: string;
  visible: boolean;
  onClose: () => void;
}

const SPRING = { damping: 20, stiffness: 200 };

export function PhotoLightbox({ uri, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const scale      = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const transX     = useSharedValue(0);
  const transY     = useSharedValue(0);
  const savedX     = useSharedValue(0);
  const savedY     = useSharedValue(0);
  const bgOpacity  = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      bgOpacity.value = withTiming(1, { duration: 220 });
    } else {
      bgOpacity.value = withTiming(0, { duration: 160 });
      scale.value      = 1;
      savedScale.value = 1;
      transX.value     = 0;
      transY.value     = 0;
      savedX.value     = 0;
      savedY.value     = 0;
    }
  }, [visible]);

  // ── Pinch: zoom in/out ────────────────────────────────────────────────────
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      "worklet";
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 8));
    })
    .onEnd(() => {
      "worklet";
      savedScale.value = scale.value;
      if (scale.value < 1.05) {
        scale.value      = withSpring(1, SPRING);
        savedScale.value = 1;
        transX.value     = withSpring(0, SPRING);
        transY.value     = withSpring(0, SPRING);
        savedX.value     = 0;
        savedY.value     = 0;
      }
    });

  // ── Pan: mover quando ampliado + swipe-down para fechar ──────────────────
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      "worklet";
      transX.value = savedX.value + e.translationX;
      transY.value = savedY.value + e.translationY;
    })
    .onEnd((e) => {
      "worklet";
      // Swipe down para fechar quando na escala original
      if (scale.value <= 1.05 && e.translationY > 120 && e.velocityY > 250) {
        runOnJS(onClose)();
        return;
      }
      savedX.value = transX.value;
      savedY.value = transY.value;
      // Voltar ao centro quando desfaz zoom
      if (scale.value <= 1.05) {
        transX.value = withSpring(0, SPRING);
        transY.value = withSpring(0, SPRING);
        savedX.value = 0;
        savedY.value = 0;
      }
    });

  // ── Duplo toque: alterna 1× ↔ 2.5× ──────────────────────────────────────
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(20)
    .onEnd((_e, success) => {
      "worklet";
      if (!success) return;
      if (scale.value > 1.5) {
        scale.value      = withSpring(1, SPRING);
        savedScale.value = 1;
        transX.value     = withSpring(0, SPRING);
        transY.value     = withSpring(0, SPRING);
        savedX.value     = 0;
        savedY.value     = 0;
      } else {
        scale.value      = withSpring(2.5, SPRING);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(doubleTap, pinch, pan);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: transX.value },
      { translateY: transY.value },
    ],
  }));

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[
          { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" },
          bgStyle,
        ]}
      >
        {/* Botão fechar */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={12}
          style={{
            position: "absolute", top: insets.top + 12, right: 16, zIndex: 20,
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: "rgba(255,255,255,0.14)",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        {/* Hint de gestos */}
        <View
          style={{
            position: "absolute", bottom: insets.bottom + 18,
            left: 0, right: 0, alignItems: "center", zIndex: 20,
          }}
        >
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: "rgba(255,255,255,0.32)" }}>
            Pinça para zoom · Duplo toque para centralizar · Arraste para fechar
          </Text>
        </View>

        {/* Imagem interativa */}
        <GestureDetector gesture={composed}>
          <Animated.Image
            source={{ uri }}
            style={[{ width: "100%", height: "100%" }, imgStyle]}
            resizeMode="contain"
          />
        </GestureDetector>
      </Animated.View>
    </Modal>
  );
}
