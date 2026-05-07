import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { PaymentStatusScreen } from "../screens/Screens";
import { paymentsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("PaymentStatusScreen", () => {
  it("carrega status de pagamento do agendamento", async () => {
    const bookingPaymentSpy = jest.spyOn(paymentsApi, "bookingPayment").mockResolvedValue({
      id: "pay-1",
      method: "CARD",
      status: "CAPTURED",
      amountCents: 12000,
      currency: "BRL",
      bookingId: "b1"
    });

    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    const showToast = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      showToast
    });

    const route = { params: { bookingId: "b1" } };
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { findByText } = render(
      <PaymentStatusScreen route={route} navigation={navigation} />
    );

    await waitFor(() => expect(bookingPaymentSpy).toHaveBeenCalledWith("token-test", "b1"));
    expect(await findByText("Booking: b1")).toBeTruthy();
    expect(await findByText("Capturado")).toBeTruthy();
  });
});
