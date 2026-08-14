/**
 * Frente 13 (segunda camada), Lote 10: login/registro/2FA nunca capturavam
 * falha no Sentry (só toast) — se o backend quebrasse esses fluxos pra todo
 * mundo, ninguém veria além do usuário individual reclamando.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { AuthLoginScreen } from "../screens/auth/AuthLoginScreen";
import { AuthRegisterScreen } from "../screens/auth/AuthRegisterScreen";
import { AuthTwoFactorScreen } from "../screens/auth/AuthTwoFactorScreen";
import { useAppState } from "../state/AppState";
import { captureException } from "../observability/sentry";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn()
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

jest.mock("../theme/MvThemeContext", () => ({
  useMvTheme: () => ({
    theme: { bg: "#000", mode: "dark", text: "#fff" }
  })
}));

function makeNavigation() {
  return { navigate: jest.fn(), goBack: jest.fn() } as any;
}

describe("Frente 13, Lote 10 — captura de erro em login/registro/2FA", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("AuthLoginScreen: falha real de login chama captureException", async () => {
    const login = jest.fn().mockRejectedValue(new Error("Erro inesperado do servidor."));
    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast: jest.fn(),
      clearToast: jest.fn(),
      isAuthenticated: false
    });

    const screen = render(
      <AuthLoginScreen navigation={makeNavigation()} route={{ key: "Login", name: "Login", params: undefined } as any} />
    );
    fireEvent.changeText(screen.getByTestId("input.auth.login.email"), "teste@email.com");
    fireEvent.changeText(screen.getByTestId("input.auth.login.password"), "Senha@123");
    fireEvent.press(screen.getByTestId("button.auth.login.submit"));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ screen: "AuthLoginScreen" })
    ));
  });

  it("AuthLoginScreen: login com sessão já autenticada (corrida suprimida) NÃO chama captureException", async () => {
    const login = jest.fn().mockRejectedValue(new Error("Credenciais invalidas."));
    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast: jest.fn(),
      clearToast: jest.fn(),
      isAuthenticated: true
    });

    const screen = render(
      <AuthLoginScreen navigation={makeNavigation()} route={{ key: "Login", name: "Login", params: undefined } as any} />
    );
    fireEvent.changeText(screen.getByTestId("input.auth.login.email"), "ok@email.com");
    fireEvent.changeText(screen.getByTestId("input.auth.login.password"), "Senha@123");
    fireEvent.press(screen.getByTestId("button.auth.login.submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("AuthTwoFactorScreen: código inválido/erro real chama captureException", async () => {
    const completeTwoFactorLogin = jest.fn().mockRejectedValue(new Error("Codigo invalido ou expirado."));
    (useAppState as jest.Mock).mockReturnValue({
      completeTwoFactorLogin,
      showToast: jest.fn()
    });

    const { getByPlaceholderText, getByText } = render(
      <AuthTwoFactorScreen route={{ params: { challengeToken: "token-abc" } } as any} navigation={makeNavigation()} />
    );
    fireEvent.changeText(getByPlaceholderText("000000"), "999999");
    fireEvent.press(getByText("Verificar"));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ screen: "AuthTwoFactorScreen" })
    ));
  });

  it("AuthRegisterScreen: falha ao criar conta chama captureException", async () => {
    const register = jest.fn().mockRejectedValue(new Error("Erro inesperado do servidor."));
    (useAppState as jest.Mock).mockReturnValue({
      register,
      showToast: jest.fn()
    });

    const { getByTestId, getByLabelText } = render(
      <AuthRegisterScreen navigation={makeNavigation()} route={{ key: "Register", name: "Register", params: undefined } as any} />
    );

    fireEvent.changeText(getByTestId("input.auth.register.name"), "Nome Teste");
    fireEvent.changeText(getByTestId("input.auth.register.email"), "novo@email.com");
    fireEvent.changeText(getByTestId("input.auth.register.phone"), "11912345678");
    fireEvent.changeText(getByTestId("input.auth.register.password"), "Senha@1234");
    fireEvent.changeText(getByTestId("input.auth.register.confirm-password"), "Senha@1234");
    fireEvent.press(getByLabelText("Aceitar termos de uso e política de privacidade"));
    fireEvent.press(getByTestId("button.auth.register.submit"));

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ screen: "AuthRegisterScreen" })
    ));
  });

  // Frente 15 (segunda camada, acessibilidade), Lote 12: o checkbox de
  // termos tinha role e label, mas não accessibilityState — como "Criar
  // conta" fica desabilitado até aceitar, um usuário de TalkBack não tinha
  // como saber se já tinha marcado ou não.
  it("AuthRegisterScreen: checkbox de termos anuncia o estado marcado/desmarcado", () => {
    (useAppState as jest.Mock).mockReturnValue({
      register: jest.fn(),
      showToast: jest.fn()
    });

    const { getByLabelText } = render(
      <AuthRegisterScreen navigation={makeNavigation()} route={{ key: "Register", name: "Register", params: undefined } as any} />
    );

    const checkbox = getByLabelText("Aceitar termos de uso e política de privacidade");
    expect(checkbox.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));

    fireEvent.press(checkbox);
    expect(checkbox.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  });

  // Frente 15 (segunda camada, acessibilidade), Lote 13: o erro de apelido
  // inválido só aparecia visualmente (texto vermelho) — sem
  // accessibilityLiveRegion, o leitor de tela nunca anunciava a mudança.
  it("AuthRegisterScreen: erro de apelido inválido tem accessibilityLiveRegion", () => {
    (useAppState as jest.Mock).mockReturnValue({
      register: jest.fn(),
      showToast: jest.fn()
    });

    const { getByTestId, getByText } = render(
      <AuthRegisterScreen navigation={makeNavigation()} route={{ key: "Register", name: "Register", params: undefined } as any} />
    );

    fireEvent.changeText(getByTestId("input.auth.register.apelido"), "ab");

    const errorText = getByText("Apenas letras minúsculas, números e _ · mínimo 3 caracteres");
    expect(errorText.props.accessibilityLiveRegion).toBe("polite");
    expect(errorText.props.accessibilityRole).toBe("alert");
  });
});
