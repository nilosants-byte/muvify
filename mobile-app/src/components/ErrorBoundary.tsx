import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as Updates from "expo-constants";
import { captureException } from "../observability/sentry";
import { GENERIC_ERROR_DESCRIPTION, GENERIC_ERROR_TITLE } from "../config/errorCopy";

interface State {
  hasError: boolean;
  errorMessage: string;
}

interface Props {
  children: React.ReactNode;
  // Frente 11 (engenharia mobile), Lote 10: até aqui só existia uma
  // instância deste boundary, no topo do app (root-stack.tsx envolvendo
  // NavigationContainer) — um erro de render em QUALQUER tela profunda
  // (pagamento, chat, upload...) derrubava a pilha de navegação inteira. As
  // props abaixo permitem instâncias LOCAIS, com copy contextual em vez do
  // genérico "recarregue o app" (que não faz sentido pra uma seção
  // específica) e um retry que não depende de fechar/reabrir nada.
  title?: string;
  description?: string;
  retryLabel?: string;
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

    const title = this.props.title ?? GENERIC_ERROR_TITLE;
    const description = this.props.description ?? `${GENERIC_ERROR_DESCRIPTION} Tente recarregar o app.`;
    const retryLabel = this.props.retryLabel ?? "Recarregar";

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
          {title}
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
          {description}
        </Text>
        <TouchableOpacity
          onPress={this.handleReload}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
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
            {retryLabel}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}

// Frente 11 (engenharia mobile), Lote 10: contenção local por tela — envolve
// só o component de uma rota específica (pagamento, chat, upload), sem
// mudar nada no cadastro de rotas além de trocar o component passado pro
// Stack.Screen/Tab.Screen. Um erro de render nessas telas volta pra lista/
// tela anterior em vez de derrubar a navegação inteira.
export function withScreenErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  boundaryProps?: { title?: string; description?: string; retryLabel?: string }
): React.ComponentType<P> {
  function ScreenWithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  }
  ScreenWithErrorBoundary.displayName = `withScreenErrorBoundary(${Component.displayName ?? Component.name ?? "Screen"})`;
  return ScreenWithErrorBoundary;
}
