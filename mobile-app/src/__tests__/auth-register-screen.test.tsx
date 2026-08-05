import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { RegisterScreen } from "../screens/Screens";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("RegisterScreen", () => {
  it("envia cadastro e exibe toast de sucesso", async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      register,
      showToast
    });

    const { getByPlaceholderText, getByRole } = render(<RegisterScreen />);

    fireEvent.changeText(getByPlaceholderText("Seu nome completo"), "Danilo");
    fireEvent.changeText(getByPlaceholderText("você@email.com"), "  danilo@email.com ");
    fireEvent.changeText(getByPlaceholderText("(11) 99999-9999"), "11999998888");
    fireEvent.changeText(getByPlaceholderText("Mínimo de 8 caracteres"), "Senha@123");
    // Épico de Frentes, Frente 11, Lote 2: RegisterScreen (legado)
    // mandava consentAccepted: true sem nenhum checkbox na UI - passa a
    // exigir o aceite explícito, mesmo padrão de AuthRegisterScreen.tsx.
    fireEvent.press(getByRole("checkbox", { name: "Aceitar termos de uso e política de privacidade" }));
    fireEvent.press(getByRole("button", { name: "Criar conta" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Danilo",
          email: "danilo@email.com",
          password: "Senha@123",
          phone: "11999998888",
          consentAccepted: true,
        })
      )
    );
    expect(showToast).toHaveBeenCalledWith("Cadastro realizado com sucesso.", "success");
  });

  it("bloqueia o cadastro sem aceitar os termos", async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      register,
      showToast
    });

    const { getByPlaceholderText, getByRole } = render(<RegisterScreen />);

    fireEvent.changeText(getByPlaceholderText("Seu nome completo"), "Danilo");
    fireEvent.changeText(getByPlaceholderText("você@email.com"), "danilo@email.com");
    fireEvent.changeText(getByPlaceholderText("(11) 99999-9999"), "11999998888");
    fireEvent.changeText(getByPlaceholderText("Mínimo de 8 caracteres"), "Senha@123");

    const button = getByRole("button", { name: "Criar conta" });
    expect(button.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(button);

    expect(register).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});



