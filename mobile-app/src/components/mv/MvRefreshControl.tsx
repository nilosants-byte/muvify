import React from "react";
import { RefreshControl, RefreshControlProps } from "react-native";
import { useMvTheme } from "../../theme/MvThemeContext";
import { hapticRefresh } from "../../utils/haptics";

type Props = Omit<RefreshControlProps, "tintColor" | "colors" | "progressBackgroundColor"> & {
  onRefresh: () => void | Promise<void>;
};

export function MvRefreshControl({ onRefresh, ...props }: Props) {
  const { theme } = useMvTheme();

  async function handleRefresh() {
    hapticRefresh();
    try {
      await onRefresh();
    } catch {
      // best effort — evita que exceções em onRefresh travem o RefreshControl
    }
  }

  return (
    <RefreshControl
      {...props}
      onRefresh={handleRefresh}
      tintColor={theme.primary}
      colors={[theme.primary]}
      progressBackgroundColor={theme.cardBg}
    />
  );
}
