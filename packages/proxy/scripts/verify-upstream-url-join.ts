import {
  collapseDuplicateApiVersionPath,
  joinUpstreamOpenAIUrl,
} from "../src/utils/probe-validate.ts";

const cases: Array<[string, string, string]> = [
  [
    "https://api.amanai.dev/v1",
    "/v1/v1/chat/completions",
    "https://api.amanai.dev/v1/chat/completions",
  ],
  [
    "https://api.amanai.dev/v1",
    "/v1/chat/completions",
    "https://api.amanai.dev/v1/chat/completions",
  ],
  [
    "http://api3.tokito.xyz/v1",
    "/v1/v1/chat/completions",
    "http://api3.tokito.xyz/v1/chat/completions",
  ],
  [
    "https://api.amanai.dev/v1",
    "/v1/v1/v1/models",
    "https://api.amanai.dev/v1/models",
  ],
];

console.assert(
  collapseDuplicateApiVersionPath("/v1/v1/chat/completions") ===
    "/v1/chat/completions",
);
for (const [endpoint, path, want] of cases) {
  const got = joinUpstreamOpenAIUrl(endpoint, path);
  if (got !== want) {
    console.error("FAIL", { endpoint, path, got, want });
    process.exit(1);
  }
  console.log("OK", got);
}
console.log("all passed");
