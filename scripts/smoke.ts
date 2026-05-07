async function ensureJson(response: Response, label: string) {
  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(
      `${label} failed with status ${response.status}${parsed ? ` - ${JSON.stringify(parsed)}` : ""}`
    );
  }

  return parsed;
}

const completionProofPayload = {
  imageBase64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+gR8V7QAAAABJRU5ErkJggg==",
  mimeType: "image/png",
  cameraFacing: "FRONT"
};

async function main() {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL not configured");
  }
  const metricsToken = process.env.METRICS_TOKEN;
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  const password = "Smoke1234";
  const suffix = `${Date.now()}`;
  const clientPhone = `1199${suffix.slice(-6)}`;
  const providerPhone = `1198${suffix.slice(-6)}`;
  const clientEmail = `smoke-client-${suffix}@example.com`;
  const providerEmail = `smoke-provider-${suffix}@example.com`;

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error("healthcheck failed");
  }

  const docs = await fetch(`${baseUrl}/api/docs`);
  if (!docs.ok) {
    throw new Error("docs check failed");
  }

  if (metricsToken) {
    const metrics = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: `Bearer ${metricsToken}` }
    });
    if (!metrics.ok) {
      throw new Error("metrics check failed");
    }
  }

  const registerClient = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Client",
      email: clientEmail,
      password,
      phone: clientPhone,
      role: "CLIENT",
      termsVersion: "2026.05",
      consentAccepted: true
    })
  });
  const clientData = await ensureJson(registerClient, "register client");

  const registerProvider = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Smoke Provider",
      email: providerEmail,
      password,
      phone: providerPhone,
      role: "PROVIDER",
      termsVersion: "2026.05",
      consentAccepted: true
    })
  });
  const providerData = await ensureJson(registerProvider, "register provider");

  const loginClient = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: clientEmail, password })
  });
  await ensureJson(loginClient, "login client");

  const refreshClient = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: clientData.refreshToken })
  });
  const refreshData = await ensureJson(refreshClient, "refresh client");

  const logoutClient = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refreshData.refreshToken })
  });
  if (logoutClient.status !== 204) {
    throw new Error("logout client failed");
  }

  const customerPaymentStatus = await fetch(`${baseUrl}/api/payments/customer`, {
    headers: { Authorization: `Bearer ${clientData.accessToken}` }
  });
  if (!customerPaymentStatus.ok) {
    throw new Error("customer payment status check failed");
  }

  const categoriesResponse = await fetch(`${baseUrl}/api/categories`);
  const categories = await ensureJson(categoriesResponse, "list categories");
  let categoryId = categories[0]?.id;

  if (!categoryId) {
    if (!adminEmail || !adminPassword) {
      throw new Error("no categories and no admin credentials configured");
    }
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const adminData = await ensureJson(adminLogin, "admin login");
    const createCategory = await fetch(`${baseUrl}/api/categories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminData.accessToken}`
      },
      body: JSON.stringify({ name: `Smoke Category ${suffix}`, description: "Smoke" })
    });
    const created = await ensureJson(createCategory, "create category");
    categoryId = created.id;
  }

  const createProfile = await fetch(`${baseUrl}/api/providers/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerData.accessToken}`
    },
    body: JSON.stringify({
      displayName: "Smoke Pro",
      bio: "Profissional para smoke test",
      experienceYears: 1,
      priceCents: 12000,
      categoryIds: [categoryId]
    })
  });
  const providerProfile = await ensureJson(createProfile, "create provider profile");
  const providerId = providerProfile.id;

  const now = new Date();
  const startOfTodayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );
  const weekday = startOfTodayUtc.getUTCDay();
  const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const createAvailability = await fetch(`${baseUrl}/api/availability`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerData.accessToken}`
    },
    body: JSON.stringify({ weekday, startTime: "00:00", endTime: "23:59", isActive: true })
  });
  await ensureJson(createAvailability, "create availability");

  const searchProviders = await fetch(`${baseUrl}/api/providers?categoryId=${categoryId}`);
  if (!searchProviders.ok) {
    throw new Error("search providers failed");
  }

  const showProvider = await fetch(`${baseUrl}/api/providers/${providerId}`);
  if (!showProvider.ok) {
    throw new Error("show provider failed");
  }

  const addFavorite = await fetch(`${baseUrl}/api/favorites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientData.accessToken}`
    },
    body: JSON.stringify({ providerId })
  });
  await ensureJson(addFavorite, "add favorite");

  const listFavorites = await fetch(`${baseUrl}/api/favorites`, {
    headers: { Authorization: `Bearer ${clientData.accessToken}` }
  });
  if (!listFavorites.ok) {
    throw new Error("list favorites failed");
  }

  const createBooking = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientData.accessToken}`
    },
    body: JSON.stringify({
      providerId,
      categoryId,
      scheduledAt,
      notes: "Smoke"
    })
  });
  const booking = await ensureJson(createBooking, "create booking");

  const confirmBooking = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerData.accessToken}`
    },
    body: JSON.stringify({ status: "CONFIRMED" })
  });
  if (!confirmBooking.ok) {
    throw new Error("confirm booking failed");
  }

  const attendanceCodeResponse = await fetch(
    `${baseUrl}/api/bookings/${booking.id}/attendance-code`,
    {
      headers: { Authorization: `Bearer ${clientData.accessToken}` }
    }
  );
  const attendanceCodeData = await ensureJson(attendanceCodeResponse, "load attendance code");

  const verifyAttendanceCode = await fetch(
    `${baseUrl}/api/bookings/${booking.id}/attendance-code/verify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerData.accessToken}`
      },
      body: JSON.stringify({ code: attendanceCodeData.code })
    }
  );
  if (!verifyAttendanceCode.ok) {
    throw new Error("verify attendance code failed");
  }

  const completeBooking = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerData.accessToken}`
    },
    body: JSON.stringify({ status: "COMPLETED", completionProof: completionProofPayload })
  });
  if (!completeBooking.ok) {
    throw new Error("complete booking failed");
  }

  const completeBookingClient = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientData.accessToken}`
    },
    body: JSON.stringify({
      status: "COMPLETED",
      completionProof: { ...completionProofPayload, cameraFacing: "BACK" }
    })
  });
  if (!completeBookingClient.ok) {
    throw new Error("complete booking (client) failed");
  }

  const createReview = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientData.accessToken}`
    },
    body: JSON.stringify({ bookingId: booking.id, rating: 5, comment: "Smoke review" })
  });
  await ensureJson(createReview, "create review");

  const listBookings = await fetch(`${baseUrl}/api/bookings/me`, {
    headers: { Authorization: `Bearer ${clientData.accessToken}` }
  });
  if (!listBookings.ok) {
    throw new Error("list bookings failed");
  }

  const listAvailability = await fetch(`${baseUrl}/api/availability/me`, {
    headers: { Authorization: `Bearer ${providerData.accessToken}` }
  });
  if (!listAvailability.ok) {
    throw new Error("list availability failed");
  }

  const removeFavorite = await fetch(`${baseUrl}/api/favorites/${providerId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${clientData.accessToken}` }
  });
  if (removeFavorite.status !== 204) {
    throw new Error("remove favorite failed");
  }

  const me = await fetch(`${baseUrl}/api/users/me`, {
    headers: { Authorization: `Bearer ${clientData.accessToken}` }
  });
  if (!me.ok) {
    throw new Error("users/me failed");
  }

  console.log("Smoke test completed successfully");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
