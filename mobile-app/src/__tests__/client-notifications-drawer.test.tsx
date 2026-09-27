import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ClientNotificationsDrawer } from "../screens/client/components/ClientNotificationsDrawer";
import { notificationsApi } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

// Achado em teste manual (2026-09-27): a tela cheia de notificações
// (NotificationsScreen, compartilhada com o profissional) não tinha nenhum
// botão em lugar nenhum do app que levasse até ela - só era alcançada como
// destino de reserva de push sem link específico (root-stack.tsx). Mesmo
// gap do drawer do profissional, corrigido aqui em espelho.
describe("ClientNotificationsDrawer — link pra central completa", () => {
  it("\"Ver central completa\" fecha o drawer e navega pra tela cheia de notificações", async () => {
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test")),
      user: { id: "client-user-1" }
    });
    jest.spyOn(notificationsApi, "inbox").mockResolvedValue([]);

    const navigateSpy = jest.fn();
    const onClose = jest.fn();

    const { findByText } = render(
      <ClientNotificationsDrawer
        visible
        navigation={{ navigate: navigateSpy }}
        onClose={onClose}
      />
    );

    const link = await findByText("Ver central completa ›");
    fireEvent.press(link);

    expect(onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith("Notifications");
  });
});
