import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { CustomerPaymentMethodScreen } from "../screens/Screens";
import { paymentsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("CustomerPaymentMethodScreen", () => {
  it("consulta status e configura método de pagamento", async () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_123";

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
      .mockResolvedValueOnce({
        configured: false,
        hasCustomer: false,
        hasDefaultPaymentMethod: false
      })
      .mockResolvedValueOnce({
        configured: true,
        hasCustomer: true,
        hasDefaultPaymentMethod: true
      });
    const createSetupIntentSpy = jest
      .spyOn(paymentsApi, "createCustomerSetupIntent")
      .mockResolvedValue({
        setupIntentId: "seti_123",
        setupIntentClientSecret: "seti_secret_123",
        customerId: "cus_123",
        ephemeralKeySecret: "ephkey_123"
      });
    const confirmSetupIntentSpy = jest
      .spyOn(paymentsApi, "confirmCustomerSetupIntent")
      .mockResolvedValue();

    const navigation = { navigate: jest.fn() };
    const { findByText, findByRole } = render(
      <CustomerPaymentMethodScreen navigation={navigation} />
    );

    expect(await findByText("Pagamento pendente")).toBeTruthy();
    fireEvent.press(await findByRole("button", { name: "Configurar com cartão" }));

    await waitFor(() => expect(createSetupIntentSpy).toHaveBeenCalledWith("token-test"));
    await waitFor(() =>
      expect(confirmSetupIntentSpy).toHaveBeenCalledWith("token-test", "seti_123")
    );
    await waitFor(() => expect(customerStatusSpy).toHaveBeenCalledTimes(2));
    expect(showToast).toHaveBeenCalledWith("Método de pagamento configurado.", "success");
  }, 20000);
});


