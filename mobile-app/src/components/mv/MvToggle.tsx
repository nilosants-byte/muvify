import React, { useEffect, useRef } from "react";
import { Animated, TouchableOpacity } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";

interface MvToggleProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
}

export function MvToggle({ value, onValueChange }: MvToggleProps) {
  const { theme } = useMvTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [value]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 18],
  });

  const bgColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.toggleOff, "#4CAF50"],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onValueChange?.(!value)}
      style={{ width: 38, height: 22 }}
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
