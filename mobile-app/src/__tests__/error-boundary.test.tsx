import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { ErrorBoundary, withScreenErrorBoundary } from "../components/ErrorBoundary";

// Frente 11 (engenharia mobile), Lote 10: até aqui só existia um
// ErrorBoundary no app inteiro (root-stack.tsx, envolvendo
// NavigationContainer) — um erro de render numa tela profunda (pagamento,
// chat, upload) derrubava a pilha de navegação inteira. Agora dá pra
// instanciar boundaries locais com copy contextual via title/description/
// retryLabel, e telas de rota podem ser envolvidas de uma vez com
// withScreenErrorBoundary.

function Bomb(): React.ReactElement {
  throw new Error("boom");
}

describe("Frente 11, Lote 10 — ErrorBoundary local", () => {
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renderiza os filhos normalmente quando não há erro", () => {
    const ui = render(
      <ErrorBoundary>
        <Text>conteúdo normal</Text>
      </ErrorBoundary>
    );
    expect(ui.getByText("conteúdo normal")).toBeTruthy();
  });

  it("captura erro de render e mostra a copy padrão quando nenhuma customizada é passada", () => {
    const ui = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(ui.getByText("Recarregar")).toBeTruthy();
  });

  it("usa title/description/retryLabel customizados quando informados", () => {
    const ui = render(
      <ErrorBoundary
        title="Não foi possível abrir o pagamento"
        description="Algo deu errado ao carregar esta tela. Toque para tentar de novo."
        retryLabel="Tentar de novo"
      >
        <Bomb />
      </ErrorBoundary>
    );
    expect(ui.getByText("Não foi possível abrir o pagamento")).toBeTruthy();
    expect(ui.getByText("Algo deu errado ao carregar esta tela. Toque para tentar de novo.")).toBeTruthy();
    expect(ui.getByText("Tentar de novo")).toBeTruthy();
  });

  it("withScreenErrorBoundary contém o erro só daquela tela, com a copy passada", () => {
    const SafeBomb = withScreenErrorBoundary(Bomb, {
      title: "Não foi possível abrir a conversa",
      description: "Algo deu errado ao carregar o chat. Toque para tentar de novo.",
      retryLabel: "Tentar de novo",
    });
    const ui = render(<SafeBomb />);
    expect(ui.getByText("Não foi possível abrir a conversa")).toBeTruthy();
  });

  it("tentar de novo reseta o estado de erro (permite tentar renderizar os filhos de novo)", () => {
    let shouldThrow = true;
    function MaybeBomb() {
      if (shouldThrow) throw new Error("boom");
      return <Text>recuperado</Text>;
    }
    const ui = render(
      <ErrorBoundary>
        <MaybeBomb />
      </ErrorBoundary>
    );
    expect(ui.getByText("Recarregar")).toBeTruthy();

    shouldThrow = false;
    fireEvent.press(ui.getByText("Recarregar"));

    expect(ui.getByText("recuperado")).toBeTruthy();
  });
});
