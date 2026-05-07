import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ForgotPasswordScreen } from "../screens/Screens";
import { authApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("ForgotPasswordScreen", () => {
  it("solicita token e redefine senha com sucesso", async () => {
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({ showToast });

    const forgotSpy = jest.spyOn(authApi, "forgotPassword").mockResolvedValue({
      message: "Se o email existir, enviaremos instruções para redefinir a senha.",
      resetToken: "reset-token-test"
    });
    const resetSpy = jest.spyOn(authApi, "resetPassword").mockResolvedValue();

    const navigation = { navigate: jest.fn() };
    const { getByPlaceholderText, findByRole, findByText } = render(
      <ForgotPasswordScreen navigation={navigation} />
    );

    fireEvent.changeText(getByPlaceholderText("você@email.com"), "teste@email.com");
    fireEvent.press(await findByRole("button", { name: "Solicitar recuperação" }));

    await waitFor(() =>
      expect(forgotSpy).toHaveBeenCalledWith({
        channel: "EMAIL",
        email: "teste@email.com"
      })
    );
    expect(await findByText("Solicitação enviada")).toBeTruthy();

    fireEvent.changeText(
      getByPlaceholderText("Mínimo 8 caracteres com letras e números"),
      "NovaSenha123"
    );
    fireEvent.press(await findByRole("button", { name: "Redefinir senha" }));

    await waitFor(() =>
      expect(resetSpy).toHaveBeenCalledWith({
        token: "reset-token-test",
        newPassword: "NovaSenha123"
      })
    );
    expect(navigation.navigate).toHaveBeenCalledWith("Login");
    expect(showToast).toHaveBeenCalledWith("Senha redefinida com sucesso. Faça login.", "success");
  }, 20000);
});




