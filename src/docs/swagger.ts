import swaggerJsdoc from "swagger-jsdoc";
import { env } from "../config/env";
import packageJson from "../../package.json";
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Personal Services Marketplace API",
      version: packageJson.version,
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
