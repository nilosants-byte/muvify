import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";

interface MvScreenProps {
  children: React.ReactNode;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  noSafeTop?: boolean;
}

export function MvScreen({ children, scrollable = false, style, padded = true, noSafeTop = false }: MvScreenProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.bg,
    paddingTop: noSafeTop ? 0 : insets.top,
  };

  const inner = padded ? (
    <View style={{ flex: 1, paddingHorizontal: 16 }}>{children}</View>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );

  if (scrollable) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        style={containerStyle}
      >
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <ScrollView
          contentContainerStyle={[{ paddingHorizontal: padded ? 16 : 0, paddingBottom: 32 }, style]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={true}
          showsVerticalScrollIndicator={false}
          pinchGestureEnabled
          maximumZoomScale={3}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[containerStyle, style]}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      {inner}
    </View>
  );
}
