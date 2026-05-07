import React from "react";
import { act, render } from "@testing-library/react-native";
import { AppNavigator } from "../navigation/AppNavigator";
import { useAppState } from "../state/AppState";
import { useConnectivity } from "../state/useConnectivity";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null
}));

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../state/useConnectivity", () => ({
  useConnectivity: jest.fn()
}));

describe("AppNavigator - rotas e offline", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("navega entre bootstrapping, onboarding e autenticacao", () => {
    const clearToast = jest.fn();
    const recheckNow = jest.fn();

    (useConnectivity as jest.Mock).mockReturnValue({
      online: true,
      checking: false,
      recheckNow
    });

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: true,
      onboardingDone: false,
      role: null,
      isAuthenticated: false,
      toast: null,
      clearToast
    });

    const ui = render(<AppNavigator />);
    expect(ui.getByText("muvi")).toBeTruthy();
    expect(ui.getByText("fy")).toBeTruthy();

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: false,
      onboardingDone: false,
      role: null,
      isAuthenticated: false,
      toast: null,
      clearToast
    });
    ui.rerender(<AppNavigator />);
    expect(ui.getByText("Evolua com acompanhamento profissional")).toBeTruthy();

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: false,
      onboardingDone: true,
      role: null,
      isAuthenticated: false,
      toast: null,
      clearToast
    });
    ui.rerender(<AppNavigator />);
    expect(ui.getByText("Como você vai usar o app?")).toBeTruthy();

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: false,
      onboardingDone: true,
      role: "CLIENT",
      isAuthenticated: false,
      toast: null,
      clearToast
    });
    ui.rerender(<AppNavigator />);
    expect(ui.getAllByText("Entrar").length).toBeGreaterThan(0);
  });

  it("aplica grace period offline e depois bloqueia acesso", () => {
    const clearToast = jest.fn();
    const recheckNow = jest.fn();
    let online = true;

    (useConnectivity as jest.Mock).mockImplementation(() => ({
      online,
      checking: false,
      recheckNow
    }));

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: false,
      onboardingDone: true,
      role: "CLIENT",
      isAuthenticated: false,
      toast: null,
      clearToast
    });

    const ui = render(<AppNavigator />);
    expect(ui.getAllByText("Entrar").length).toBeGreaterThan(0);

    online = false;
    ui.rerender(<AppNavigator />);
    expect(ui.getByText("Conexão instável. Reconectando...")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    ui.rerender(<AppNavigator />);
    expect(ui.getByText("Sem conexão com a internet")).toBeTruthy();
  });
});



