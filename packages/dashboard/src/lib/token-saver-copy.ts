/**
 * Canonical Token Saver help copy — used by portal i18n mirror, admin dashboard, Discord panel.
 * Keep in sync with packages/proxy/src/utils/token-saver/* behavior.
 */

export type TokenSaverFeatureCopy = {
	id: "rtk" | "groupyCompact" | "headroom" | "caveman" | "ponytail" | "batch";
	label: string;
	defaultOn: boolean;
	/** One-line effect */
	effectShort: string;
	/** Fuller “what it does” */
	effectLong: string;
	/** Short example */
	exampleShort: string;
	/** Longer example / case study */
	exampleLong: string;
	/** Short risk */
	riskShort: string;
	/** Longer risk / trade-off */
	riskLong: string;
};

export const TOKEN_SAVER_PIPELINE =
	"RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch";

export const TOKEN_SAVER_INTRO = {
	short:
		"Pipeline hemat token sebelum ke upstream. Default ikut admin; portal/Discord bisa Default / Nyala / Mati. Header X-Token-Saver: off mematikan semua untuk 1 request.",
	long:
		"Setiap request dilalui pipeline hemat token sebelum dikirim ke upstream. Ada tiga jenis hemat: (1) perkecil body tiap hop — RTK, Groupy Compact, Headroom; (2) kurangi jumlah hop — Batch; (3) kurangi verbosity output — Caveman, Ponytail. Urutan: " +
		TOKEN_SAVER_PIPELINE +
		". Global di Admin Settings; override per user di Portal/Discord; kill-switch per request via header X-Token-Saver: off.",
};

export const TOKEN_SAVER_FEATURES: TokenSaverFeatureCopy[] = [
	{
		id: "rtk",
		label: "RTK (tool compress)",
		defaultOn: true,
		effectShort: "Perkecil dump tool besar → input model lebih ringan.",
		effectLong:
			"RTK (Real Token Killer) memotong isi tool_result yang berisik (git, grep, ls, read, shell, dll.): bersihkan ANSI, collapse baris kosong, lalu simpan head+tail dalam budget karakter (default ~2000). Tidak menyentuh hasil write/edit/apply_diff dan tidak mengubah struktur tool_calls. Cocok untuk Cline/Roo/Kilo/OpenCode yang sering mengirim dump penuh.",
		exampleShort: "git status 50KB → ~2KB (head+tail).",
		exampleLong:
			"Tanpa RTK: satu `git status` / `grep` besar bisa 30–100KB di setiap hop berikutnya. Dengan RTK: hanya awal+akhir dump yang dikirim (~budget 2KB), cukup untuk model mengerti status tanpa mengirim seluruh tengah file.",
		riskShort: "Bagian tengah dump panjang bisa hilang.",
		riskLong:
			"Kalau informasi penting hanya ada di tengah output panjang, model bisa melewatkannya dan minta baca ulang. Write/edit tidak terpengaruh. Matikan (Off) jika Anda sering butuh isi penuh dari tool read besar.",
	},
	{
		id: "groupyCompact",
		label: "Groupy Compact",
		defaultOn: true,
		effectShort: "Stub tool result lama di agent loop; yang terbaru tetap penuh.",
		effectLong:
			"Di sesi agent multi-hop, Groupy Compact mempertahankan N tool result terakhir secara penuh dan mengganti dump lama yang berisik dengan stub berlabel `[groupy-compact]`. Tidak menghapus message dan tidak menyentuh hasil write/edit. Level admin: lite / balanced (default) / aggressive.",
		exampleShort: "Hop ke-120 tidak kirim ulang isi file dari hop 5–30.",
		exampleLong:
			"Sesi Cline 150 hop: tanpa compact, hop 120 mengirim ulang seluruh isi file yang dibaca di hop awal. Dengan balanced: hanya ~3 tool terakhir penuh; yang lebih tua jadi stub 1 baris — hemat besar di history yang terus tumbuh.",
		riskShort: "Model kadang minta re-read file yang di-stub.",
		riskLong:
			"Stub mengorbankan detail lama. Model mungkin tool-call read lagi (1 hop ekstra) — biasanya tetap lebih hemat daripada mengirim ulang file penuh di setiap hop. Pakai lite jika terlalu agresif; aggressive juga bisa memangkas prose assistant lama.",
	},
	{
		id: "headroom",
		label: "Headroom",
		defaultOn: false,
		effectShort: "Compress history lewat layanan eksternal (jika URL admin ada).",
		effectLong:
			"Mengirim riwayat messages ke endpoint compress eksternal (URL di-set admin). Timeout 3 detik, fail-open: jika gagal/timeout, request tetap jalan tanpa compress. Tanpa URL, fitur ini no-op meski Nyala.",
		exampleShort: "40 pesan history → ~15 pesan ringkas (bergantung service).",
		exampleLong:
			"Berguna saat context history sudah sangat panjang dan layanan compress tersedia. Tidak menggantikan RTK/Compact; melengkapi dengan ringkasan history di level conversation.",
		riskShort: "Butuh URL admin; gagal = no-op; tergantung layanan pihak ketiga.",
		riskLong:
			"Kualitas ringkasan bergantung service eksternal. Latency +3s worst case. Data history dikirim ke URL yang dikonfigurasi admin — pastikan trusted. Default OFF sampai URL siap.",
	},
	{
		id: "caveman",
		label: "Caveman",
		defaultOn: false,
		effectShort: "Dorong jawaban model lebih singkat → hemat output tokens.",
		effectLong:
			"Menyisipkan system prompt agar model menjawab lebih ringkas (level 1 ringan … 5 gaya telegram). Tidak mengubah tool calls — hanya gaya prosa balasan. Level di-set admin.",
		exampleShort: "Paragraf panjang → 2–3 kalimat (level menengah).",
		exampleLong:
			"Level 3: kalimat pendek, tanpa preamble. Level 5: ultra-terse. Bermanfaat jika Anda ingin jawaban chat pendek; kurang cocok untuk agent yang butuh penjelasan langkah panjang.",
		riskShort: "Gaya kasar/telegram; bisa mengganggu agent yang butuh narasi.",
		riskLong:
			"Bisa membuat jawaban terasa kasar atau kurang jelas. Agent yang mengandalkan penjelasan sebelum tool call mungkin bingung. Default OFF — aktifkan sadar gaya.",
	},
	{
		id: "ponytail",
		label: "Ponytail",
		defaultOn: false,
		effectShort: "Skip basa-basi agent IDE → loop lebih ramping.",
		effectLong:
			"System prompt anti-boilerplate untuk agent IDE: skip “Sure!”, skip mengulang rencana, langsung aksi (level lite / full / ultra di admin). Mengurangi chat filler di sekitar tool use.",
		exampleShort: "Skip “I'll read the file…” → langsung tool call.",
		exampleLong:
			"Sebelum: ack + restatement rencana + tool + ringkasan pasca-tool. Sesudah: langsung tool_calls. Hemat completion tokens di Cline/Roo tanpa mengubah kemampuan tools.",
		riskShort: "Kurang narasi/status di chat.",
		riskLong:
			"Anda melihat lebih sedikit status text di UI agent. Beberapa user merasa “gelap” soal apa yang dilakukan agent. Default OFF.",
	},
	{
		id: "batch",
		label: "Batch",
		defaultOn: true,
		effectShort: "Minta beberapa read/edit sekaligus → lebih sedikit hop.",
		effectLong:
			"System prompt agar model merencanakan read/search/edit yang dibutuhkan dalam SATU balasan (parallel tool_calls), bukan satu file per giliran. Mengurangi jumlah hit upstream dan pengiriman ulang history. Tidak memaksa; skip schema legacy functions tunggal.",
		exampleShort: "5 file: 5 hit terpisah → idealnya 1 hit bersamaan.",
		exampleLong:
			"Task butuh 5 file diketahui di awal: tanpa batch sering 5 round-trip. Dengan nudge: diminta bersamaan. Langkah yang wajib sequential (edit → test → baca error → fix) tidak bisa dihemat. Efek besar di model yang jarang batch (GLM/Flash); lebih kecil di Grok/Opus yang sudah sering multi-call.",
		riskShort: "Hanya nudge; model bisa tetap 1-call; tidak memendekkan langkah sequential.",
		riskLong:
			"Tidak menjamin compliance. Tidak mengubah limit accounting. Jika model memaksa batch langkah yang harus sequential, bisa salah — prompt sudah menekankan hanya batch yang bisa direncanakan di muka.",
	},
];

export function getTokenSaverFeature(id: TokenSaverFeatureCopy["id"]): TokenSaverFeatureCopy {
	const f = TOKEN_SAVER_FEATURES.find((x) => x.id === id);
	if (!f) throw new Error(`Unknown token saver feature: ${id}`);
	return f;
}

/** Compact Discord field value (≤1024). */
export function formatFeatureDiscordBlurb(f: TokenSaverFeatureCopy): string {
	return (
		`**Efek:** ${f.effectShort}\n` +
		`**Contoh:** ${f.exampleShort}\n` +
		`**Risiko:** ${f.riskShort}\n` +
		`-# ${f.effectLong.slice(0, 180)}${f.effectLong.length > 180 ? "…" : ""}`
	);
}
