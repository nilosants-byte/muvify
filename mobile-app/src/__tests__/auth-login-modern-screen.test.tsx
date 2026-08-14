import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AuthLoginScreen } from "../screens/auth/AuthLoginScreen";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("AuthLoginScreen", () => {
  const navigation = { navigate: jest.fn() } as any;
  const route = { key: "Login", name: "Login", params: undefined } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("evita login duplicado em envios quase simultaneos", async () => {
    const login = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();
    const clearToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast,
      clearToast,
      isAuthenticated: false
    });

    const screen = render(<AuthLoginScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByTestId("input.auth.login.email"), "teste@email.com");
    fireEvent.changeText(screen.getByTestId("input.auth.login.password"), "Senha@123");

    // User can tap fast twice; only one request must be fired while first is in-flight.
    act(() => {
      fireEvent.press(screen.getByTestId("button.auth.login.submit"));
      fireEvent.press(screen.getByTestId("button.auth.login.submit"));
    });

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  });

  it("normaliza email e limpa toasts residuais ao logar", async () => {
    const login = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();
    const clearToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast,
      clearToast,
      isAuthenticated: false
    });

    const screen = render(<AuthLoginScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByTestId("input.auth.login.email"), "  USER@Email.Com ");
    fireEvent.changeText(screen.getByTestId("input.auth.login.password"), "Senha@123");
    fireEvent.press(screen.getByTestId("button.auth.login.submit"));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: "user@email.com",
        password: "Senha@123"
      })
    );

    expect(clearToast).toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("@muvify/rememberMeEmail");
    expect(showToast).not.toHaveBeenCalledWith("Credenciais invalidas.", "error");
  });

  it("suprime toast de erro quando a sessao ja foi autenticada", async () => {
    const login = jest.fn().mockRejectedValue(new Error("Credenciais invalidas."));
    const showToast = jest.fn();
    const clearToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast,
      clearToast,
      isAuthenticated: true
    });

    const screen = render(<AuthLoginScreen navigation={navigation} route={route} />);

    fireEvent.changeText(screen.getByTestId("input.auth.login.email"), "ok@email.com");
    fireEvent.changeText(screen.getByTestId("input.auth.login.password"), "Senha@123");
    fireEvent.press(screen.getByTestId("button.auth.login.submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(showToast).not.toHaveBeenCalledWith("Credenciais invalidas.", "error");
  });

  // Frente 15 (segunda camada, acessibilidade), Lote 1: nenhum dos dois
  // campos tem `label` visual (só placeholder, "seu@email.com"/"••••••••")
  // — sem accessibilityLabel explícito, o leitor de tela anunciava só o
  // placeholder quando vazio e nada quando preenchido. Pior caso: a senha
  // só seria anunciada como uma sequência de bullets.
  it("campos de e-mail e senha têm accessibilityLabel explícito pro leitor de tela", () => {
    (useAppState as jest.Mock).mockReturnValue({
      login: jest.fn(),
      showToast: jest.fn(),
      clearToast: jest.fn(),
      isAuthenticated: false
    });

    const screen = render(<AuthLoginScreen navigation={navigation} route={route} />);

    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByLabelText("Senha")).toBeTruthy();
  });
});
