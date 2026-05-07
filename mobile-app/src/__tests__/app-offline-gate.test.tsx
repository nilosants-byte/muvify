import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
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

describe("AppNavigator - bloqueio offline", () => {
  it("mostra tela offline e dispara rechecagem manual", () => {
    const recheckNow = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      bootstrapping: false,
      onboardingDone: true,
      role: "CLIENT",
      isAuthenticated: true,
      toast: null,
      clearToast: jest.fn()
    });

    (useConnectivity as jest.Mock).mockReturnValue({
      online: false,
      checking: false,
      recheckNow
    });

    const { getByText, getByRole } = render(<AppNavigator />);

    expect(getByText("Sem conexão com a internet")).toBeTruthy();
    fireEvent.press(getByRole("button", { name: "Tentar novamente" }));
    expect(recheckNow).toHaveBeenCalledTimes(1);
  });
});


