import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // agente() lê prompts/<area>/<papel>.md em tempo de execução; garante que esses
  // arquivos entram no bundle das rotas de API na Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**/*"],
  },
};

export default nextConfig;
