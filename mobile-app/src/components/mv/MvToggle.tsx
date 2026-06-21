import React, { useEffect, useRef } from "react";
import { Animated, TouchableOpacity } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";

interface MvToggleProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
}

export function MvToggle({ value, onValueChange, disabled = false }: MvToggleProps) {
  const { theme } = useMvTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    anim.stopAnimation();
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 18],
  });

  const bgColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.toggleOff, theme.primary],
  });

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.9}
      onPress={() => { if (!disabled) onValueChange?.(!value); }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ disabled, checked: value }}
      style={{ width: 38, height: 22, opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={{
          width: 38,
          height: 22,
          borderRadius: 11,
          backgroundColor: bgColor,
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: "#FFFFFF",
            position: "absolute",
            top: 2,
            transform: [{ translateX }],
          }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}
