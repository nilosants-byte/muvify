import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfessionalStudentsScreen } from "../screens/professional/ProfessionalStudentsScreen";
import { providersApi, ProviderDashboardStudentsResponse, ProviderStudent } from "../services/api/client";
import { useAppState } from "../state/AppState";

// Frente 11 (engenharia mobile), Lote 5: lista de alunos virou FlatList
// (virtualização real, teto do backend é 2000 alunos) + busca com debounce
// (filtro é local, mas recalcular sobre até 2000 itens a cada tecla ainda
// pesa) + StudentRow memoizado com callbacks estáveis.

jest.mock("../state/AppState", () => ({
  useAppState: jest.fn()
}));

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useFocusEffect: (cb: React.EffectCallback) => { React.useEffect(cb, []); }
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function buildStudent(overrides: Partial<ProviderStudent>): ProviderStudent {
  return {
    clientId: "client-1",
    name: "Aluno Padrão",
    email: "aluno@teste.com",
    phone: null,
    profilePhotoUrl: null,
    anamnesisPending: false,
    trainingPlanPending: false,
    fichaRenewalPending: false,
    fichaValidUntil: null,
    active: true,
    paymentPastDue: false,
    totalValueCents: 15000,
    services: [{ serviceKind: "PRESENTIAL", serviceLabel: "Presencial", valueCents: 15000, active: true, nextSessionAt: null, validUntil: null, paymentPastDue: false }],
    totalBookings: 3,
    totalContracts: 0,
    lastActivityAt: "2026-08-01T10:00:00.000Z",
    ...overrides
  };
}

function buildResponse(students: ProviderStudent[]): ProviderDashboardStudentsResponse {
  return {
    providerId: "provider-1",
    totalStudents: students.length,
    serviceCounts: {
      ALL: students.length,
      PRESENTIAL: students.length,
      ONLINE_CONSULTANCY: 0,
      ONLINE_CONSULTANCY_SPECIALIZED: 0,
      COMBO: 0
    },
    students
  };
}

describe("Frente 11, Lote 5 — ProfessionalStudentsScreen", () => {
  beforeEach(() => {
    (useAppState as jest.Mock).mockReturnValue({
      runWithAuth: jest.fn(async (operation: (token: string) => Promise<unknown>) => operation("token-test")),
      showToast: jest.fn()
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("carrega e lista alunos, navegando pro detalhe do aluno certo ao tocar na linha", async () => {
    const anaSilva = buildStudent({ clientId: "client-ana", name: "Ana Silva", email: "ana@teste.com" });
    const brunoCosta = buildStudent({ clientId: "client-bruno", name: "Bruno Costa", email: "bruno@teste.com" });
    jest.spyOn(providersApi, "dashboardStudents").mockResolvedValue(buildResponse([anaSilva, brunoCosta]));

    const navigate = jest.fn();
    const ui = renderWithQueryClient(
      <ProfessionalStudentsScreen navigation={{ navigate } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());
    expect(ui.getByText("Bruno Costa")).toBeTruthy();

    fireEvent.press(ui.getByText("Bruno Costa"));
    expect(navigate).toHaveBeenCalledWith("ProfessionalStudentDetail", { clientId: "client-bruno" });
  }, 30000);

  it("busca é debounced: filtro só aplica depois que o usuário para de digitar", async () => {
    jest.useFakeTimers();
    const anaSilva = buildStudent({ clientId: "client-ana", name: "Ana Silva", email: "ana@teste.com" });
    const brunoCosta = buildStudent({ clientId: "client-bruno", name: "Bruno Costa", email: "bruno@teste.com" });
    jest.spyOn(providersApi, "dashboardStudents").mockResolvedValue(buildResponse([anaSilva, brunoCosta]));

    const ui = renderWithQueryClient(
      <ProfessionalStudentsScreen navigation={{ navigate: jest.fn() } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());

    const input = ui.getByPlaceholderText("Buscar aluno por nome ou email");
    fireEvent.changeText(input, "bruno");

    // Logo após digitar, o debounce ainda não estourou — os dois continuam na tela.
    expect(ui.getByText("Ana Silva")).toBeTruthy();
    expect(ui.getByText("Bruno Costa")).toBeTruthy();

    await waitFor(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(ui.queryByText("Ana Silva")).toBeNull());
    expect(ui.getByText("Bruno Costa")).toBeTruthy();
  });

  it("toca no selo de anamnese pendente e navega com clientId e clientName corretos", async () => {
    const student = buildStudent({
      clientId: "client-ana",
      name: "Ana Silva",
      anamnesisPending: true
    });
    jest.spyOn(providersApi, "dashboardStudents").mockResolvedValue(buildResponse([student]));

    const navigate = jest.fn();
    const ui = renderWithQueryClient(
      <ProfessionalStudentsScreen navigation={{ navigate } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());

    fireEvent.press(ui.getByTestId("student-row-anamnesis-client-ana"));
    expect(navigate).toHaveBeenCalledWith("ProfessionalStudentAnamnesis", {
      clientId: "client-ana",
      clientName: "Ana Silva"
    });
  });

  // Frente 15 (segunda camada, acessibilidade), Lote 9: os 3 selos de
  // pendência (anamnese/ficha/renovação) comunicavam status crítico só por
  // ícone+cor, sem accessibilityLabel — um usuário de leitor de tela não
  // sabia que aquele aluno tinha pendência nem conseguia agir sobre ela.
  it("selos de pendência (anamnese, ficha, renovação) têm accessibilityLabel identificando o aluno", async () => {
    const student = buildStudent({
      clientId: "client-ana",
      name: "Ana Silva",
      anamnesisPending: true,
      trainingPlanPending: true,
      fichaRenewalPending: true
    });
    jest.spyOn(providersApi, "dashboardStudents").mockResolvedValue(buildResponse([student]));

    const ui = renderWithQueryClient(
      <ProfessionalStudentsScreen navigation={{ navigate: jest.fn() } as any} route={{} as any} />
    );

    await waitFor(() => expect(ui.getByText("Ana Silva")).toBeTruthy());

    expect(ui.getByLabelText("Anamnese pendente de Ana Silva")).toBeTruthy();
    expect(ui.getByLabelText("Ficha de treino pendente de Ana Silva")).toBeTruthy();
    expect(ui.getByLabelText("Renovação de ficha pendente de Ana Silva")).toBeTruthy();
  });
});
