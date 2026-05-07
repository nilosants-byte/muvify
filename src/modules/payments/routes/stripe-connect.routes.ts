import { Router } from "express";

function renderHtml(title: string, description: string, hint: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #101820;
        color: #f3f5f7;
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      section {
        width: min(560px, 100%);
        border-radius: 12px;
        border: 1px solid #2b3a4a;
        background: #152232;
        padding: 24px;
        box-sizing: border-box;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
      }
      code {
        background: #0d1722;
        border: 1px solid #223446;
        border-radius: 6px;
        padding: 2px 6px;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${title}</h1>
        <p>${description}</p>
        <p>${hint}</p>
      </section>
    </main>
  </body>
</html>`;
}

export const stripeConnectRoutes = Router();

stripeConnectRoutes.get("/stripe/return", (_request, response) => {
  response
    .status(200)
    .type("html")
    .send(
      renderHtml(
        "Stripe onboarding completed",
        "The provider was redirected back to this backend callback URL.",
        "Next step: confirm account status in your app by calling GET /api/payments/provider/account."
      )
    );
});

stripeConnectRoutes.get("/stripe/refresh", (_request, response) => {
  response
    .status(200)
    .type("html")
    .send(
      renderHtml(
        "Stripe onboarding needs retry",
        "Stripe requested a refresh in the onboarding flow.",
        "Generate a new onboarding link by calling POST /api/payments/provider/account/onboarding-link."
      )
    );
});
