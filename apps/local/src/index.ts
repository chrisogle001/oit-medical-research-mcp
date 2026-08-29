#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMedicalResearchMcpServer } from "@oit-medical-research/mcp";

serveStdio(() =>
  createMedicalResearchMcpServer({
    ...(process.env.CONTACT_EMAIL ? { contactEmail: process.env.CONTACT_EMAIL } : {}),
    ...(process.env.NCBI_API_KEY ? { ncbiApiKey: process.env.NCBI_API_KEY } : {})
  })
);
