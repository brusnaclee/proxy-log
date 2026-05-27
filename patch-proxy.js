const fs = require('fs');
let content = fs.readFileSync('packages/proxy/src/routes/proxy.ts', 'utf8');

content = content.replace(
  'import { refreshModelCatalog, getModelCatalogResponse } from "../utils/model-catalog.js";',
  'import { refreshModelCatalog, getModelCatalogResponse, getProviderForModel } from "../utils/model-catalog.js";'
);

content = content.replace(
  'const upstreamBase = config.upstreamEndpoint.replace(/\\/\\$/, "");',
  \const targetProvider = await getProviderForModel(model);
  if (!targetProvider) {
    return c.json({ error: { message: "No active upstream provider available for model " + model, type: "server_error" } }, 500);
  }
  const upstreamBase = targetProvider.endpoint.replace(/\\/\\$/, "");\
);

content = content.replace(
  'upstreamHeaders["Authorization"] = \Bearer \\;',
  'upstreamHeaders["Authorization"] = \Bearer \\;'
);

content = content.replace(
  'const upstreamBase2 = config.upstreamEndpoint.replace(/\\/\\$/, "");',
  \const targetProvider2 = await getProviderForModel("unknown");
    if (!targetProvider2) return c.json({ error: { message: "No active upstream provider", type: "server_error" } }, 500);
    const upstreamBase2 = targetProvider2.endpoint.replace(/\\/\\$/, "");\
);

content = content.replace(
  'upstreamHeaders2["Authorization"] = \Bearer \\;',
  'upstreamHeaders2["Authorization"] = \Bearer \\;'
);

content = content.replace(
  'if (!config || !config.upstreamApiKey) {',
  'if (!config) {'
);

fs.writeFileSync('packages/proxy/src/routes/proxy.ts', content);
console.log("Done");
