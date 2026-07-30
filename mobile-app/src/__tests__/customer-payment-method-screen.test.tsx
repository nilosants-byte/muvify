import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { CustomerPaymentMethodScreen } from "../screens/Screens";
import { paymentsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("CustomerPaymentMethodScreen", () => {
  it("consulta status e exibe estado pendente", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    const customerStatusSpy = jest
      .spyOn(paymentsApi, "customerStatus")
      .mockResolvedValue({
        configured: false,
        hasCustomer: false,
        hasDefaultPaymentMethod: false,
        hasOutstandingDebt: false
      });

    const navigation = { navigate: jest.fn() };
    const { findByText } = render(
      <CustomerPaymentMethodScreen navigation={navigation} />
    );

    expect(await findByText("Pagamento pendente")).toBeTruthy();
    expect(await findByText("Configure um cartão para liberar novos agendamentos.")).toBeTruthy();
    await waitFor(() => expect(customerStatusSpy).toHaveBeenCalledWith("token-test"));
  }, 20000);

  it("exibe estado configurado quando cartão está salvo", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    (useAppState as jest.Mock).mockReturnValue({ runWithAuth, showToast: jest.fn() });

    jest.spyOn(paymentsApi, "customerStatus").mockResolvedValue({
      configured: true,
      hasCustomer: true,
      hasDefaultPaymentMethod: true,
      hasOutstandingDebt: false
    });

    const { findByText } = render(<CustomerPaymentMethodScreen navigation={{ navigate: jest.fn() }} />);
    expect(await findByText("Pagamento configurado")).toBeTruthy();
    expect(await findByText("Sua conta está pronta para criar agendamentos.")).toBeTruthy();
  }, 20000);
});


