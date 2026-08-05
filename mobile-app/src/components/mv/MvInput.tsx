import React, { forwardRef, useState } from "react";
import {
  StyleProp,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";
import { MvText } from "./MvText";

interface MvInputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  style?: StyleProp<ViewStyle>;
  secureTextEntry?: boolean;
}

export const MvInput = forwardRef<TextInput, MvInputProps>(
  function MvInput({ label, style, secureTextEntry, ...rest }, ref) {
    const { theme } = useMvTheme();
    const [focused, setFocused] = useState(false);
    const [showText, setShowText] = useState(false);

    const isSecure = secureTextEntry && !showText;

    return (
      <View style={style}>
        {label ? (
          <MvText variant="caption" style={{ color: theme.labelColor, marginBottom: 6 }}>
            {label}
          </MvText>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderWidth: 1,
            borderRadius: 11,
            paddingHorizontal: 13,
            paddingVertical: 11,
            backgroundColor: focused
              ? (theme.mode === "dark" ? "rgba(76,175,80,0.03)" : "rgba(76,175,80,0.02)")
              : theme.inputBg,
            borderColor: focused ? "rgba(76,175,80,0.40)" : theme.inputBorder,
          }}
        >
          <TextInput
            ref={ref}
            {...rest}
            secureTextEntry={isSecure}
            onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
            placeholderTextColor={theme.text3}
            selectionColor={theme.primary}
            style={[
              typography.body2,
              {
                flex: 1,
                color: theme.inputText,
                padding: 0,
                margin: 0,
              },
            ]}
          />
          {secureTextEntry ? (
            <TouchableOpacity onPress={() => setShowText((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={showText ? "Ocultar senha" : "Mostrar senha"}>
              <Ionicons
                name={showText ? "eye-outline" : "eye-off-outline"}
                size={18}
                color={theme.text3}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }
);
