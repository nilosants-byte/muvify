import React from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  scale?: number;
}

export function PressableScale({
  onPress,
  onPressIn,
  onPressOut,
  style,
  children,
  scale = 0.97,
  accessibilityRole,
  ...pressableProps
}: PressableScaleProps) {
  const scaleValue = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole ?? "button"}
      {...pressableProps}
      onPressIn={(event) => {
        scaleValue.value = withTiming(Math.min(1, Math.max(0.5, scale)), {
          duration: 80,
          easing: Easing.out(Easing.quad),
        });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scaleValue.value = withTiming(1, {
          duration: 140,
          easing: Easing.out(Easing.quad),
        });
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
