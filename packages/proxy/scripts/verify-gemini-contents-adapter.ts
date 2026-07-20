import {
	looksLikeGeminiContentsBody,
	convertGeminiContentsToOpenAI,
} from "../src/utils/gemini-contents-adapter.ts";

const sample = {
	model: "amanai/amanai/glm-5.2",
	project: "proj",
	request: {
		contents: [
			{ role: "user", parts: [{ text: "hello" }] },
			{ role: "model", parts: [{ text: "hi there" }] },
			{ role: "user", parts: [{ text: "Continue" }] },
		],
		generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
	},
};

console.assert(looksLikeGeminiContentsBody(sample) === true, "detect wrapped");
console.assert(
	looksLikeGeminiContentsBody({ model: "x", messages: [{ role: "user", content: "a" }] }) ===
		false,
	"skip when messages present",
);

const out = convertGeminiContentsToOpenAI(sample);
if (!out || out.messages.length !== 3) {
	console.error("FAIL convert", out);
	process.exit(1);
}
console.assert(out.model === "amanai/amanai/glm-5.2");
console.assert(out.messages[0].role === "user" && out.messages[0].content === "hello");
console.assert(out.messages[1].role === "assistant" && out.messages[1].content === "hi there");
console.assert(out.max_tokens === 128);
console.assert(out.temperature === 0.2);

// empty messages + contents still converts
const mixed = {
	model: "amanai/amanai/glm-5.2",
	messages: [],
	request: { contents: [{ role: "user", parts: [{ text: "pong?" }] }] },
};
console.assert(looksLikeGeminiContentsBody(mixed) === true);
const out2 = convertGeminiContentsToOpenAI(mixed)!;
console.assert(out2.messages[0].content === "pong?");

console.log("gemini-contents-adapter: all passed");
