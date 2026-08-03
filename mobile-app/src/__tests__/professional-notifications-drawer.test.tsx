import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ProfessionalNotificationsDrawer } from "../screens/professional/components/ProfessionalNotificationsDrawer";
import { notificationsApi, NotificationInboxItem } from "../services/api/client";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

function studentPostMentionNotification(): NotificationInboxItem {
  return {
    id: "notif-student-post",
    title: "Novo post sobre o treino com você",
    body: "@aluno postou na comunidade sobre o treino com você no Muvify.",
    data: { type: "STUDENT_POST_MENTION", clientId: "client-99" },
    readAt: null,
    createdAt: new Date().toISOString()
  };
}

// Épico de Frentes, Frente 9, Lote 5: STUDENT_POST_MENTION (Frente 8, Lote 8)
// não tinha nenhum destino no drawer - clientId chegava no payload e nunca
// era usado, então tocar a notificação não navegava pra lugar nenhum.
describe("ProfessionalNotificationsDrawer — STUDENT_POST_MENTION", () => {
  it("navega pro detalhe do aluno ao tocar a notificação de post do aluno", async () => {
    const runWithAuth = jest.fn(async (operation: (token: string) => Promise<unknown>) =>
      operation("token-test")
    );
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth,
      user: { id: "provider-user-1" }
    });
    jest.spyOn(notificationsApi, "inbox").mockResolvedValue([studentPostMentionNotification()]);

    const navigateSpy = jest.fn();
    const onClose = jest.fn();

    const { findByText } = render(
      <ProfessionalNotificationsDrawer
        visible
        navigation={{ navigate: navigateSpy }}
        onClose={onClose}
      />
    );

    const item = await findByText("Novo post sobre o treino com você");
    fireEvent.press(item);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith("ProfessionalStudentAnamnesis", {
        clientId: "client-99",
        clientName: "Aluno"
      })
    );
  });
});
