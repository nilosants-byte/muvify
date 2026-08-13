/**
 * Frente 13 (segunda camada), Lote 13: captura de selfie de comprovação
 * (gate de liberação de pagamento) e falha ao obter token de push nunca
 * capturavam erro no Sentry.
 */
import React from "react";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SelfieProofCapture } from "../components/media/SelfieProofCapture";
import { getPushRegistrationPayload } from "../services/notifications/push";
import { captureException } from "../observability/sentry";

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn()
}));

jest.mock("../theme/MvThemeContext", () => ({
  useMvTheme: () => ({
    theme: { bg: "#000", mode: "dark", text: "#fff", primary: "#0f0", border: "#333", primarySubtle: "#050" }
  })
}));

describe("Frente 13, Lote 13 — captura de erro na selfie de comprovação", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falha ao abrir a câmera chama captureException", async () => {
    jest.spyOn(ImagePicker, "requestCameraPermissionsAsync").mockRejectedValueOnce(
      new Error("falha simulada de câmera")
    );

    const { getByText } = render(
      <SelfieProofCapture value={null} onChange={jest.fn()} showToast={jest.fn()} />
    );

    fireEvent.press(getByText("Tirar selfie"));

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ component: "SelfieProofCapture", action: "captureProof" })
      )
    );
  });

  it("falha ao salvar a selfie (onChange rejeita) chama captureException", async () => {
    jest.spyOn(ImagePicker, "requestCameraPermissionsAsync").mockResolvedValueOnce({
      status: "granted"
    } as any);
    jest.spyOn(ImagePicker, "launchCameraAsync").mockResolvedValueOnce({
      canceled: false,
      assets: [{ base64: "abc123", mimeType: "image/jpeg", uri: "file://selfie.jpg" }]
    } as any);
    const onChange = jest.fn().mockRejectedValue(new Error("falha simulada ao salvar"));

    const { getByText } = render(
      <SelfieProofCapture value={null} onChange={onChange} showToast={jest.fn()} />
    );

    fireEvent.press(getByText("Tirar selfie"));
    await waitFor(() => expect(getByText("Salvar selfie")).toBeTruthy());
    fireEvent.press(getByText("Salvar selfie"));

    await waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ component: "SelfieProofCapture", action: "saveDraft" })
      )
    );
  });
});

describe("Frente 13, Lote 13 — captura de erro ao obter token de push", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falha ao obter o token de push chama captureException e retorna null (degradação graciosa)", async () => {
    jest.spyOn(Notifications, "getExpoPushTokenAsync").mockRejectedValueOnce(
      new Error("falha simulada do serviço de push")
    );

    const result = await getPushRegistrationPayload();

    expect(result).toBeNull();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: "push-token-registration" })
    );
  });
});
