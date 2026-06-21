/**
 * Testes críticos do fluxo de consultoria online.
 *
 * Cobre:
 * - Cliente cria solicitação de consultoria
 * - Cliente lista suas solicitações ativas e arquivadas
 * - Cliente aceita proposta do provider (com método de pagamento)
 * - Cliente recusa proposta do provider
 * - Provider responde a solicitação com oferta
 * - Provider lista planos de treino entregues
 * - Catálogo de provider (público)
 */
import {
  ApiError,
  consultancyApi,
  ConsultancyContract,
  ConsultancyRequest,
  MyTrainingResponse,
  ProviderConsultancyCatalog,
} from "../services/api/client";

// Mock do fetch para controlar respostas de rede
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response);
}

function buildRequest(overrides?: Partial<ConsultancyRequest>): ConsultancyRequest {
  return {
    id: "req-001",
    providerId: "prov-001",
    clientId: "client-001",
    status: "OPEN",
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
    trainingNeedText: "Quero perder peso",
    limitationText: "Tenho problema no joelho",
    ...overrides,
  };
}

function buildContract(overrides?: Partial<ConsultancyContract>): ConsultancyContract {
  return {
    id: "contract-001",
    requestId: "req-001",
    providerId: "prov-001",
    clientId: "client-001",
    offerId: "offer-001",
    status: "PENDING_PAYMENT",
    paymentStatus: "PENDING",
    paymentAmountCents: 30000,
    providerAmountCents: 27000,
    platformAmountCents: 3000,
    deliveryDeadlineAt: "2026-04-08T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  // resetAllMocks também limpa a fila de mockReturnValueOnce, evitando vazamento
  // entre testes quando um teste falha antes de consumir o mock
  jest.resetAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("Consultoria — catálogo público", () => {
  it("carrega catálogo de provider sem autenticação", async () => {
    const catalog: ProviderConsultancyCatalog = {
      provider: {
        id: "prov-001",
        displayName: "Coach Silva",
        photoUrl: null,
        specialties: ["Hipertrofia", "Emagrecimento"],
      },
      onlineConsultancyEnabled: true,
      offers: [
        {
          id: "offer-001",
          providerId: "prov-001",
          kind: "ONLINE_CONSULTANCY",
          title: "Consultoria Mensal",
          billingCycle: "MONTHLY",
          priceCents: 30000,
          basePriceUpdatedAt: "2026-01-01T00:00:00Z",
          isPromotion: false,
          isActive: true,
        } as any,
      ],
      prebuiltPlanPreviews: [],
    };
    mockFetch.mockReturnValueOnce(jsonResponse(catalog));

    const result = await consultancyApi.providerCatalog("prov-001");
    expect(result.provider.displayName).toBe("Coach Silva");
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].title).toBe("Consultoria Mensal");
    expect(result.onlineConsultancyEnabled).toBe(true);
  });
});

describe("Consultoria — fluxo do cliente", () => {
  const TOKEN = "client-token-123";

  it("cria solicitação de consultoria com dados de saúde", async () => {
    const createdRequest = buildRequest({ status: "OPEN" });
    mockFetch.mockReturnValueOnce(jsonResponse(createdRequest, 201));

    const result = await consultancyApi.createRequest(TOKEN, {
      providerId: "prov-001",
      trainingNeedText: "Quero perder peso",
      limitationText: "Tenho problema no joelho",
      extraInfoText: "Treino 3x por semana",
    });

    expect(result.id).toBe("req-001");
    expect(result.status).toBe("OPEN");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(options.body);
    expect(body.providerId).toBe("prov-001");
    expect(body.trainingNeedText).toBe("Quero perder peso");
  });

  it("lista solicitações ativas do cliente", async () => {
    const requests = [
      buildRequest({ id: "req-001", status: "OPEN" }),
      buildRequest({ id: "req-002", status: "RESPONDED" }),
    ];
    mockFetch.mockReturnValueOnce(jsonResponse(requests));

    const result = await consultancyApi.myRequests(TOKEN);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("OPEN");
    expect(result[1].status).toBe("RESPONDED");
  });

  it("lista solicitações arquivadas do cliente", async () => {
    const archived = [buildRequest({ id: "req-003", status: "REFUSED" })];
    mockFetch.mockReturnValueOnce(jsonResponse(archived));

    const result = await consultancyApi.myArchivedRequests(TOKEN, { status: "REFUSED" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("REFUSED");
  });

  it("cliente aceita proposta com cartão de crédito", async () => {
    const contract = buildContract({ status: "PENDING_PAYMENT", paymentMethod: "CREDIT_CARD" });
    mockFetch.mockReturnValueOnce(jsonResponse({ request: buildRequest({ status: "ACCEPTED" }), contract }));

    const result = await consultancyApi.decideRequest(TOKEN, "req-001", {
      decision: "ACCEPT",
      paymentMethod: "CREDIT_CARD",
    });

    expect(result.contract?.status).toBe("PENDING_PAYMENT");
    expect(result.request.status).toBe("ACCEPTED");

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.decision).toBe("ACCEPT");
    expect(body.paymentMethod).toBe("CREDIT_CARD");
  });

  it("cliente recusa proposta do provider", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ request: buildRequest({ status: "REFUSED" }), contract: null })
    );

    const result = await consultancyApi.decideRequest(TOKEN, "req-001", { decision: "REFUSE" });

    expect(result.request.status).toBe("REFUSED");
    expect(result.contract).toBeNull();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.decision).toBe("REFUSE");
  });

  it("cliente visualiza plano de treino ativo", async () => {
    const training: MyTrainingResponse = {
      locked: false,
      waitingDelivery: [],
      contracts: [
        {
          id: "contract-001",
          requestId: "req-001",
          providerId: "provider-001",
          clientId: "client-001",
          offerId: "offer-001",
          status: "ACTIVE",
          paymentStatus: "CAPTURED",
          paymentAmountCents: 30000,
          providerAmountCents: 27000,
          platformAmountCents: 3000,
          deliveryDeadlineAt: "2026-05-01T00:00:00Z",
          trainingPlans: [
            {
              id: "plan-001",
              providerId: "provider-001",
              title: "Plano Hipertrofia 4 semanas",
              description: "Treino focado em volume",
              isPrebuilt: false,
              isActive: true,
              exercises: [
                { id: "ex-001", name: "Supino reto", repetitionsSets: "4x12", load: "60kg", sortOrder: 1 },
              ],
            },
          ],
        },
      ],
    };
    mockFetch.mockReturnValueOnce(jsonResponse(training));

    const result = await consultancyApi.myTraining(TOKEN);
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].trainingPlans?.[0].title).toBe("Plano Hipertrofia 4 semanas");
    expect(result.contracts[0].trainingPlans?.[0].exercises).toHaveLength(1);
  });
});

describe("Consultoria — fluxo do provider", () => {
  const PROVIDER_TOKEN = "provider-token-456";

  it("provider lista solicitações recebidas", async () => {
    const requests = [buildRequest({ status: "OPEN" })];
    mockFetch.mockReturnValueOnce(jsonResponse(requests));

    const result = await consultancyApi.providerRequests(PROVIDER_TOKEN);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("OPEN");
  });

  it("provider responde com oferta de consultoria", async () => {
    const responded = buildRequest({ status: "RESPONDED", quotedOfferId: "offer-001" });
    mockFetch.mockReturnValueOnce(jsonResponse(responded));

    const result = await consultancyApi.respondRequest(PROVIDER_TOKEN, "req-001", {
      quotedOfferId: "offer-001",
      providerResponseText: "Posso ajudar com seu objetivo!",
    });

    expect(result.status).toBe("RESPONDED");
    expect(result.quotedOfferId).toBe("offer-001");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.quotedOfferId).toBe("offer-001");
    expect(body.providerResponseText).toBe("Posso ajudar com seu objetivo!");
  });

  it("provider entrega plano de treino", async () => {
    const trainingPlan = { id: "plan-001", title: "Plano Personalizado", exercises: [] };
    mockFetch.mockReturnValueOnce(jsonResponse(trainingPlan));

    const result = await consultancyApi.deliverContract(PROVIDER_TOKEN, "contract-001", {
      title: "Plano Personalizado",
      exercises: [
        { name: "Agachamento", repetitionsSets: "4x10", load: "80kg", sortOrder: 1 },
        { name: "Leg press", repetitionsSets: "3x15", load: "120kg", sortOrder: 2 },
      ],
    });

    expect(result.title).toBe("Plano Personalizado");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.exercises).toHaveLength(2);
    expect(body.exercises[0].name).toBe("Agachamento");
  });
});

describe("Consultoria — cenários de erro", () => {
  const TOKEN = "token-test";

  it("rejeita criação quando provider não tem oferta ativa (422)", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ message: "Provider sem ofertas ativas." }, 422));

    await expect(
      consultancyApi.createRequest(TOKEN, { providerId: "prov-sem-ofertas" })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejeita limite de 3 requests por dia (429)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "Limite de 3 solicitacoes por dia atingido." }, 429)
    );

    await expect(
      consultancyApi.createRequest(TOKEN, { providerId: "prov-001" })
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  it("rejeita decisão quando request não está aguardando decisão (400)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ message: "A solicitação não esta aguardando decisao do aluno." }, 400)
    );

    await expect(
      consultancyApi.decideRequest(TOKEN, "req-already-decided", { decision: "ACCEPT" })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
