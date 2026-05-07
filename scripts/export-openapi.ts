import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { swaggerSpec } from "../src/docs/swagger";

const outputDir = resolve(process.cwd(), "docs");
const outputPath = resolve(outputDir, "openapi.json");

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2), "utf8");

console.log(`OpenAPI exported to ${outputPath}`);
