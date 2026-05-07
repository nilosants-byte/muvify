import swaggerJsdoc from "swagger-jsdoc";
import { env } from "../config/env";
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Personal Services Marketplace API",
      version: "1.0.0",
      description: "API para marketplace de servicos pessoais."
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}/api`
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    }
  },
  apis: ["./src/modules/**/*.ts"]
});
