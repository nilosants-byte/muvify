import React, { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

interface ScreenEntranceProps {
  children: React.ReactNode;
  /** Atraso em ms antes de iniciar a animação (útil quando há um header sticky acima) */
  delay?: number;
}

export function ScreenEntrance({ children, delay = 0 }: ScreenEntranceProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    const run = () => {
      opacity.value = withTiming(1, {
        duration: 240,
        easing: Easing.out(Easing.quad),
      });
      translateY.value = withTiming(0, {
        duration: 240,
        easing: Easing.out(Easing.quad),
      });
    };

    if (delay > 0) {
      const t = setTimeout(run, delay);
      return () => clearTimeout(t);
    }
    run();
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
    flex: 1,
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}
