import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Updates from "expo-constants";
import { captureException } from "../observability/sentry";

interface State {
  hasError: boolean;
  errorMessage: string;
}

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    captureException(error, { componentStack: info.componentStack ?? "" });
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#030806",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        <Text style={{ fontSize: 48, marginBottom: 16 }}>⚠️</Text>
        <Text
          style={{
            fontFamily: "DMSans_700Bold",
            fontSize: 20,
            color: "#FFFFFF",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          Algo deu errado
        </Text>
        <Text
          style={{
            fontFamily: "DMSans_400Regular",
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 20,
          }}
        >
          Ocorreu um erro inesperado. Tente recarregar o app.
        </Text>
        <TouchableOpacity
          onPress={this.handleReload}
          accessibilityRole="button"
          accessibilityLabel="Recarregar app"
          style={{
            height: 52,
            paddingHorizontal: 32,
            borderRadius: 18,
            backgroundColor: "#24E66D",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: "#030806" }}>
            Recarregar
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}
