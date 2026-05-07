import React, { useEffect } from "react";
import { ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "../utils/reanimated";

type FadeUpProps = {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
};

export const FadeUp = ({
  children,
  delay = 0,
  duration = 400,
  style,
}: FadeUpProps) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    const fade = () => {
      opacity.value = withTiming(1, {
        duration,
        easing: Easing.out(Easing.quad),
      });
      translateY.value = withTiming(0, {
        duration,
        easing: Easing.out(Easing.quad),
      });
    };

    if (delay > 0) {
      opacity.value = withDelay(
        delay,
        withTiming(1, { duration, easing: Easing.out(Easing.quad) })
      );
      translateY.value = withDelay(
        delay,
        withTiming(0, { duration, easing: Easing.out(Easing.quad) })
      );
    } else {
      fade();
    }
  }, [delay, duration, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[animStyle, style]}>{children}</Animated.View>;
};

export const fadeUpDelay = (index: number, step = 50) => index * step;

type PulseGreenProps = {
  children: React.ReactNode;
  size?: number;
  color?: string;
  active?: boolean;
  style?: ViewStyle;
};

export const PulseGreen = ({
  children,
  size = 12,
  color = "rgba(76,175,80,0.4)",
  active = true,
  style,
}: PulseGreenProps) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(1 + size / 20, {
            duration: 800,
            easing: Easing.out(Easing.quad),
          })
        ),
        -1,
        false
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 0 }),
          withTiming(0, { duration: 800, easing: Easing.out(Easing.quad) })
        ),
        -1,
        false
      );
    } else {
      scale.value = 1;
      opacity.value = 0;
    }
  }, [active, opacity, scale, size]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{ position: "relative", alignSelf: "flex-start" }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          ringStyle,
          {
            position: "absolute",
            top: -size / 2,
            left: -size / 2,
            right: -size / 2,
            bottom: -size / 2,
            borderRadius: 999,
            backgroundColor: color,
          },
        ]}
      />
      {children}
    </Animated.View>
  );
};

type SpringPopProps = {
  children: React.ReactNode;
  delay?: number;
  style?: ViewStyle;
};

export const SpringPop = ({ children, delay = 0, style }: SpringPopProps) => {
  const scale = useSharedValue(0.85);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const cfg = { damping: 10, stiffness: 200, mass: 0.8 };
    if (delay > 0) {
      scale.value = withDelay(delay, withSpring(1, cfg));
      opacity.value = withDelay(delay, withTiming(1, { duration: 150 }));
    } else {
      scale.value = withSpring(1, cfg);
      opacity.value = withTiming(1, { duration: 150 });
    }
  }, [delay, opacity, scale]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[animStyle, style]}>{children}</Animated.View>;
};

export const usePressSpring = (toScale = 0.97) => {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    scale.value = withSpring(toScale, { damping: 15, stiffness: 300 });
  };

  const onPressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return { animStyle, onPressIn, onPressOut };
};

export const useLoaderSweep = () => {
  const translateX = useSharedValue(-1);

  useEffect(() => {
    translateX.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: 0 }),
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 300 })
      ),
      -1,
      false
    );
  }, [translateX]);

  const getStyle = (barWidth: number) =>
    useAnimatedStyle(() => ({
      transform: [
        {
          translateX: interpolate(translateX.value, [-1, 1], [-barWidth, barWidth]),
        },
      ],
    }));

  return { getStyle };
};
