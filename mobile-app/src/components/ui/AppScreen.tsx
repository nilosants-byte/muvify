import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControlProps,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';
import { useAppState } from '../../state/AppState';
import { useTheme } from '../../theme/useTheme';

interface AppScreenProps {
  children: React.ReactNode;
  scrollable?: boolean;
  padded?: boolean;
  centered?: boolean;
  constrained?: boolean;
  backgroundColor?: string;
  keyboardAvoiding?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function AppScreen({
  children,
  scrollable = false,
  padded = true,
  centered = false,
  constrained = true,
  backgroundColor,
  keyboardAvoiding = false,
  contentContainerStyle,
  style,
  testID,
  refreshControl,
  edges = ['left', 'right', 'bottom'],
}: AppScreenProps) {
  const { themeMode } = useAppState();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale, width: screenWidth } = useWindowDimensions();
  const resolvedBackground = backgroundColor ?? colors.background;

  const dynamicPaddingTop = Math.round(
    theme.layout.screenTopSpacing * Math.min(fontScale, 1.2),
  );
  const dynamicPaddingBottom = Math.max(
    24,
    Math.round(theme.spacing.xl * Math.min(fontScale, 1.2)),
  );
  const dynamicPaddingH =
    screenWidth <= 320
      ? Math.round(theme.layout.screenHorizontalPadding * 0.8)
      : theme.layout.screenHorizontalPadding;

  const paddedStyle: StyleProp<ViewStyle> = padded
    ? {
        paddingHorizontal: dynamicPaddingH,
        paddingTop: dynamicPaddingTop,
        paddingBottom: dynamicPaddingBottom,
      }
    : undefined;

  const content = scrollable ? (
    <ScrollView
      automaticallyAdjustKeyboardInsets={keyboardAvoiding && Platform.OS === 'ios'}
      bounces={false}
      alwaysBounceVertical={false}
      contentContainerStyle={[
        styles.scrollContent,
        constrained && styles.constrained,
        paddedStyle,
        centered && styles.centered,
        contentContainerStyle,
      ]}
      keyboardDismissMode={keyboardAvoiding ? (Platform.OS === 'ios' ? 'interactive' : 'on-drag') : 'none'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      testID={testID}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.flex,
        constrained && styles.constrained,
        paddedStyle,
        centered && styles.centered,
        contentContainerStyle,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
  const wrapped = keyboardAvoiding ? (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      style={styles.flex}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );
  return (
    <>
      <StatusBar
        barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={resolvedBackground}
        translucent={Platform.OS === 'android'}
      />

      <SafeAreaView
        edges={edges}
        style={[styles.safeArea, { backgroundColor: resolvedBackground }, style]}
      >
        {wrapped}
      </SafeAreaView>
    </>
  );
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  constrained: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  centered: {
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
  },
});
