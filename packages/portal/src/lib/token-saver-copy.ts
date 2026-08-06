/**
 * Canonical Token Saver help copy — portal, admin dashboard, Discord.
 * Keep in sync with packages/proxy/src/utils/token-saver/* behavior.
 */

export type TokenSaverFeatureId =
	| "antiWaste"
	| "groupyCompact"
	| "batch"
	| "streamToNonstream"
	| "nonstreamToStream"
	| "rtk"
	| "headroom"
	| "caveman"
	| "ponytail";

export type TokenSaverFeatureCopy = {
	id: TokenSaverFeatureId;
	label: string;
	group: "groupy" | "classic";
	defaultOn: boolean;
	effectShort: string;
	effectLong: string;
	exampleShort: string;
	exampleLong: string;
	riskShort: string;
	riskLong: string;
	intensityHint: string;
	safeZone: string;
};

export const GROUPY_TOKEN_SAVER_LABEL = "Groupy Token Saver";
export const CLASSIC_TOKEN_SAVER_LABEL = "Token Saver";

export const TOKEN_SAVER_PIPELINE =
	"RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch (+ Anti-Waste parallel)";

export const TOKEN_SAVER_INTRO = {
	short:
		"Pipeline hemat token + Anti-Waste IDE. Groupy = Anti-Waste/Compact/Batch (default ON). Klasik = RTK/Headroom/Caveman/Ponytail. Intensity: preset atau custom.",
	long:
		"Request dilalui pipeline hemat token sebelum upstream, plus Anti-Waste (dedupe/nudge/short-circuit) untuk loop tool IDE. " +
		"**Groupy Token Saver** (Anti-Waste, Groupy Compact, Soft Batch) default ON. **Token Saver** klasik (RTK, Headroom, Caveman, Ponytail) — RTK default ON, lain OFF. " +
		"Tiap fitur punya enable + intensity (preset lite/balanced/aggressive atau custom angka). " +
		"Global di Admin; override per user di Portal/Discord. Header X-Token-Saver: off / X-Anti-Waste: off.",
};

export const TOKEN_SAVER_FEATURES: TokenSaverFeatureCopy[] = [
	{
		id: "antiWaste",
		label: "Anti-Waste",
		group: "groupy",
		defaultOn: true,
		effectShort: "Stop loop baca tool yang sama (nudge → dedupe → short-circuit).",
		effectLong:
			"Melacak signature tool berisik (read/search/shell). Nudge system, stub dump duplikat, lalu short-circuit ke ask_followup/attempt_completion jika loop identik berlanjut. Signature memakai path+range/content sample — baca parsial beda baris tidak bentrok.",
		exampleShort: "Cline baca file yang sama 8× → short-circuit ramah (balanced).",
		exampleLong:
			"Tanpa Anti-Waste: agent bisa baca ulang file/range yang sama puluhan hop. Dengan balanced: setelah beberapa hit identik, proxy menghentikan loop tanpa burn token upstream.",
		riskShort: "Terlalu agresif bisa stop re-read yang sah.",
		riskLong:
			"shortCircuitAt kecil (&lt;6) mudah memotong agent yang sengaja re-read. Pakai lite/custom tinggi jika sering partial read. Matikan jika IDE Anda jarang loop.",
		intensityHint:
			"Makin kecil nudge/dedupe/shortCircuit = makin agresif. balanced = 3/4/8. Zona agresif: shortCircuitAt &lt; 6.",
		safeZone: "shortCircuitAt ≥ 8 (balanced+) — aman untuk partial reads.",
	},
	{
		id: "groupyCompact",
		label: "Groupy Compact",
		group: "groupy",
		defaultOn: true,
		effectShort: "Stub tool result lama; yang terbaru tetap penuh.",
		effectLong:
			"Pertahankan N tool result terakhir penuh; dump lama berisik diganti stub [groupy-compact]. Tidak sentuh write/edit. Custom: keepLastN + stubMinChars.",
		exampleShort: "Hop ke-120 tidak kirim ulang isi file hop 5–30.",
		exampleLong:
			"Sesi Cline panjang: tanpa compact, history mengirim ulang seluruh dump lama. Balanced: ~3 tool terakhir penuh.",
		riskShort: "Model kadang minta re-read file yang di-stub.",
		riskLong:
			"keepLastN kecil / stubMinChars kecil = lebih banyak stub. Aggressive juga trim prose assistant lama.",
		intensityHint:
			"keepLastN kecil + stubMinChars kecil = agresif. balanced = keep 3, stub ≥1500.",
		safeZone: "keepLastN ≥ 3 dan stubMinChars ≥ 1000.",
	},
	{
		id: "batch",
		label: "Soft Batch",
		group: "groupy",
		defaultOn: true,
		effectShort: "Nudge parallel tool_calls → lebih sedikit hop.",
		effectLong:
			"System prompt agar model batch read/search independen. Strength 1–5 mengubah kerasnya nudge. Cline-family dapat wording lebih aman (jangan omit content write).",
		exampleShort: "5 file: idealnya 1 hit bersamaan.",
		exampleLong:
			"Task butuh 5 path diketahui: nudge batch mengurangi round-trip. Langkah sequential tetap boleh terpisah.",
		riskShort: "Hanya nudge; strength tinggi bisa memaksa batch berlebihan.",
		riskLong: "Strength 4–5 = agresif. Tidak mengubah schema tools.",
		intensityHint: "strength 1 lembut … 5 kuat. balanced = 3. Agresif: ≥4.",
		safeZone: "strength 1–3.",
	},
	{
		id: "streamToNonstream",
		label: "Stream Translate: Stream → Non-stream",
		group: "groupy",
		defaultOn: false,
		effectShort:
			"Request streaming diubah jadi non-stream ke upstream; balasan di-fake-stream balik ke client.",
		effectLong:
			"Client tetap kirim stream:true dan tetap menerima SSE seperti biasa — tapi ke upstream, proxy mengirim stream:false, menunggu jawaban penuh, lalu memutarnya sebagai stream sekali kirim (role → content → finish+usage → [DONE]). Berguna untuk upstream yang menagih overhead billing di mode streaming. Tidak berlaku untuk client Anthropic /v1/messages & Responses API (passthrough normal).",
		exampleShort:
			"Beberapa upstream: prompt_tokens stream 2.138 → 136 untuk prompt yang sama (pajak flat hilang).",
		exampleLong:
			"Beberapa upstream menambahkan pajak prompt_tokens flat di setiap request streaming. Dengan toggle ini upstream melihat non-stream sehingga usage yang dilaporkan (dan kuota yang dipotong) kembali normal, sementara client tidak perlu mengubah apa pun.",
		riskShort: "Token pertama datang lebih lambat (jawaban dirakit penuh dulu).",
		riskLong:
			"Tidak ada incremental typing — client 'diam' sampai upstream selesai, lalu seluruh jawaban muncul sekaligus. Generasi sangat panjang dibatasi timeout non-stream (~90s per attempt), jadi kurang cocok untuk jawaban super panjang.",
		intensityHint: "Murni on/off — tidak ada intensity.",
		safeZone: "Aman untuk chat/agent normal; hindari untuk generasi >90 detik.",
	},
	{
		id: "nonstreamToStream",
		label: "Stream Translate: Non-stream → Stream",
		group: "groupy",
		defaultOn: false,
		effectShort:
			"Request non-stream diubah jadi streaming ke upstream; proxy merakit SSE jadi satu JSON.",
		effectLong:
			"Client kirim stream:false dan tetap menerima satu JSON utuh — tapi ke upstream, proxy meminta stream:true lalu merakit seluruh chunk SSE menjadi respons lengkap. Berguna untuk upstream yang sering timeout / putus koneksi idle di mode non-stream pada generasi panjang.",
		exampleShort: "Upstream lambat: SSE mengalir jadi koneksi tidak dianggap idle.",
		exampleLong:
			"Beberapa upstream memutus koneksi non-stream yang lama diam. Mode streaming mengirim byte terus-menerus sehingga generasi panjang selamat, lalu proxy mengembalikannya sebagai JSON biasa.",
		riskShort: "Di provider dengan 'pajak stream' justru lebih boros.",
		riskLong:
			"Kalau upstream menagih overhead di mode streaming (pajak flat prompt_tokens), toggle ini menambah biaya, bukan menghemat. Jangan nyalakan bersamaan dengan Stream → Non-stream untuk provider yang sama.",
		intensityHint: "Murni on/off — tidak ada intensity.",
		safeZone: "Nyalakan hanya jika sering kena timeout non-stream.",
	},
	{
		id: "rtk",
		label: "RTK (tool compress)",
		group: "classic",
		defaultOn: true,
		effectShort: "Potong dump tool besar → head+tail dalam budget.",
		effectLong:
			"RTK membersihkan ANSI, collapse blank, simpan head+tail dalam maxChars. Tidak menyentuh write/edit.",
		exampleShort: "git status 50KB → ~2KB.",
		exampleLong: "Dump grep besar dipangkas ke budget tanpa hilangkan struktur tool_calls.",
		riskShort: "Bagian tengah dump bisa hilang.",
		riskLong: "maxChars &lt; 1000 agresif — info tengah sering hilang.",
		intensityHint: "maxChars kecil = agresif. lite=4000, balanced=2000, aggressive=800.",
		safeZone: "maxChars ≥ 1000.",
	},
	{
		id: "headroom",
		label: "Headroom",
		group: "classic",
		defaultOn: false,
		effectShort: "Compress history lewat URL eksternal (fail-open).",
		effectLong:
			"POST messages ke URL compress admin. Timeout custom; gagal = lanjut tanpa compress.",
		exampleShort: "40 pesan → ~15 ringkas (bergantung service).",
		exampleLong: "Berguna history sangat panjang jika service trusted tersedia.",
		riskShort: "Butuh URL; timeout pendek = sering no-op.",
		riskLong: "Data history dikirim ke URL admin. Timeout &lt;1.5s agresif (sering timeout).",
		intensityHint: "timeoutMs: lite=5000, balanced=3000, aggressive=1000.",
		safeZone: "timeoutMs ≥ 2000.",
	},
	{
		id: "caveman",
		label: "Caveman",
		group: "classic",
		defaultOn: false,
		effectShort: "Dorong jawaban lebih singkat (level 1–5).",
		effectLong: "System prompt verbosity. Level tinggi = gaya telegram.",
		exampleShort: "Paragraf → 2–3 kalimat (level menengah).",
		exampleLong: "Level 5 ultra-terse. Kurang cocok untuk agent yang butuh narasi.",
		riskShort: "Gaya kasar; level ≥4 agresif.",
		riskLong: "Bisa mengganggu agent yang butuh penjelasan sebelum tool call.",
		intensityHint: "1 ringan … 5 ultra. Confirm jika ≥4.",
		safeZone: "level 1–3.",
	},
	{
		id: "ponytail",
		label: "Ponytail",
		group: "classic",
		defaultOn: false,
		effectShort: "Skip basa-basi agent IDE.",
		effectLong: "Anti-boilerplate: skip Sure!/rencana diulang; langsung aksi. lite/full/ultra.",
		exampleShort: "Skip “I'll read…” → langsung tool.",
		exampleLong: "Hemat completion tokens di Cline/Roo.",
		riskShort: "Kurang status text di chat (ultra paling gelap).",
		riskLong: "ultra = agresif; UI agent lebih ‘gelap’.",
		intensityHint: "lite &lt; full &lt; ultra (agresif).",
		safeZone: "lite atau full.",
	},
];

export function getTokenSaverFeature(id: TokenSaverFeatureId): TokenSaverFeatureCopy {
	const f = TOKEN_SAVER_FEATURES.find((x) => x.id === id);
	if (!f) throw new Error(`Unknown token saver feature: ${id}`);
	return f;
}

export function groupyFeatures() {
	return TOKEN_SAVER_FEATURES.filter((f) => f.group === "groupy");
}

export function classicFeatures() {
	return TOKEN_SAVER_FEATURES.filter((f) => f.group === "classic");
}

export function formatFeatureDiscordBlurb(f: TokenSaverFeatureCopy): string {
	return (
		`**Efek:** ${f.effectShort}\n` +
		`**Contoh:** ${f.exampleShort}\n` +
		`**Risiko:** ${f.riskShort}\n` +
		`**Intensity:** ${f.intensityHint}\n` +
		`-# ${f.safeZone}`
	);
}

/** True if preset/custom should show confirm warning. */
export function intensityNeedsConfirm(
	feature: TokenSaverFeatureId,
	mode: "preset" | "custom",
	preset: string,
	custom?: Record<string, unknown> | null,
): boolean {
	if (mode === "preset") {
		if (feature === "caveman") return Number(preset) >= 4;
		if (feature === "ponytail") return preset === "ultra";
		return preset === "aggressive";
	}
	const c = custom || {};
	switch (feature) {
		case "antiWaste":
			return Number(c.shortCircuitAt ?? 99) < 6;
		case "groupyCompact":
			return Number(c.keepLastN ?? 3) <= 2 || Number(c.stubMinChars ?? 1500) < 600;
		case "batch":
			return Number(c.strength ?? 3) >= 4;
		case "rtk":
			return Number(c.maxChars ?? 2000) < 1000;
		case "headroom":
			return Number(c.timeoutMs ?? 3000) < 1500;
		case "caveman":
			return Number(c.level ?? 2) >= 4;
		case "ponytail":
			return Number(c.strength ?? 1) >= 3 || c.level === "ultra";
		default:
			return false;
	}
}
