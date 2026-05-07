import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { LoginScreen } from "../screens/Screens";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("LoginScreen", () => {
  it("faz login com email trimado e mostra toast de sucesso", async () => {
    const login = jest.fn().mockResolvedValue(undefined);
    const showToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      login,
      showToast
    });

    const navigation = { navigate: jest.fn() };
    const { getByPlaceholderText, getByRole } = render(
      <LoginScreen navigation={navigation} />
    );

    fireEvent.changeText(getByPlaceholderText("você@email.com"), "  teste@email.com  ");
    fireEvent.changeText(getByPlaceholderText("Sua senha"), "123456");
    fireEvent.press(getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: "teste@email.com",
        password: "123456"
      })
    );
    expect(showToast).toHaveBeenCalledWith("Login realizado com sucesso.", "success");
  });
});


