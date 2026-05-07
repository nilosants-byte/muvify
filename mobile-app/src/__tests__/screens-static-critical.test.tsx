import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import {
  CustomerProfileScreen,
  CustomerSettingsScreen,
  GenericErrorScreen,
  HomeHeaderRoleTag,
  NotificationsScreen,
  OfflineRequiredScreen,
  OnboardingScreen,
  RoleSelectionScreen,
  SessionExpiredScreen,
  SplashScreen,
  SupportScreen
} from "../screens/Screens";
import { useAppState } from "../state/AppState";

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

describe("Telas estaticas e navegacao base", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renderiza splash, onboarding e selecao de perfil", () => {
    const completeOnboarding = jest.fn();
    const chooseRole = jest.fn();

    (useAppState as jest.Mock).mockReturnValue({
      completeOnboarding,
      chooseRole
    });

    const splash = render(<SplashScreen />);
    expect(splash.getByText("muvi")).toBeTruthy();
    expect(splash.getByText("fy")).toBeTruthy();

    const onboarding = render(<OnboardingScreen />);
    fireEvent.press(onboarding.getByText("Pular"));
    expect(completeOnboarding).toHaveBeenCalledTimes(1);

    fireEvent.press(onboarding.getByRole("button", { name: "Próximo" }));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    onboarding.unmount();

    const roleSelection = render(<RoleSelectionScreen />);
    fireEvent.press(roleSelection.getByRole("button", { name: "Continuar como Cliente" }));
    fireEvent.press(roleSelection.getByRole("button", { name: "Continuar como Profissional" }));

    expect(chooseRole).toHaveBeenCalledWith("CLIENT");
    expect(chooseRole).toHaveBeenCalledWith("PROVIDER");
  });

  it("renderiza perfil/configurações e telas auxiliares", () => {
    const signOut = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({
      role: "PROVIDER",
      user: { name: "Maria", email: "maria@test.com", phone: "11999999999" },
      signOut
    });

    const profileNavigation = { navigate: jest.fn() };
    const profile = render(<CustomerProfileScreen navigation={profileNavigation} />);
    expect(profile.getByText("Perfil do cliente")).toBeTruthy();
    fireEvent.press(profile.getByRole("button", { name: "Configurações" }));
    fireEvent.press(profile.getByRole("button", { name: "Método de pagamento" }));
    fireEvent.press(profile.getByRole("button", { name: "Sair" }));

    expect(profileNavigation.navigate).toHaveBeenCalledWith("CustomerSettings");
    expect(profileNavigation.navigate).toHaveBeenCalledWith("CustomerPaymentMethod");
    expect(signOut).toHaveBeenCalledTimes(1);

    const settingsNavigation = { navigate: jest.fn() };
    const settings = render(<CustomerSettingsScreen navigation={settingsNavigation} />);
    fireEvent.press(settings.getByRole("button", { name: "Método de pagamento" }));
    fireEvent.press(settings.getByRole("button", { name: "Simular sessão expirada" }));
    expect(settingsNavigation.navigate).toHaveBeenCalledWith("CustomerPaymentMethod");
    expect(settingsNavigation.navigate).toHaveBeenCalledWith("SessionExpired");

    const roleTag = render(<HomeHeaderRoleTag />);
    expect(roleTag.getByText("Profissional")).toBeTruthy();

    const notifications = render(<NotificationsScreen />);
    expect(notifications.getByText("Notificações")).toBeTruthy();

    const support = render(<SupportScreen />);
    expect(support.getByText("Ajuda e suporte")).toBeTruthy();

    const session = render(<SessionExpiredScreen />);
    fireEvent.press(session.getByRole("button", { name: "Fazer login novamente" }));
    expect(signOut).toHaveBeenCalledTimes(2);

    const genericNavigation = { goBack: jest.fn() };
    const generic = render(<GenericErrorScreen navigation={genericNavigation} />);
    fireEvent.press(generic.getByRole("button", { name: "Tentar novamente" }));
    expect(genericNavigation.goBack).toHaveBeenCalledTimes(1);

    const retry = jest.fn();
    const offline = render(<OfflineRequiredScreen onRetry={retry} retrying={false} />);
    fireEvent.press(offline.getByRole("button", { name: "Tentar novamente" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});


