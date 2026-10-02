import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Prepara as variáveis de ambiente antes de qualquer arquivo do projeto ser carregado
    setupFiles: ["src/test/setup.ts"],
    // Antes de cada teste, as funções simuladas voltam ao estado inicial (um teste não interfere no outro)
    mockReset: true,
  },
});
