import { useState, useEffect } from "react";

export type Lang = "id" | "en";

const STORAGE_KEY = "portal_lang";

const dict: Record<string, Record<Lang, string>> = {
  Overview: { id: "Ringkasan", en: "Overview" },
  Keys: { id: "Kunci API", en: "Keys" },
  Activity: { id: "Aktivitas", en: "Activity" },
  Settings: { id: "Pengaturan", en: "Settings" },
  Requests: { id: "Prompts", en: "Prompts" },
  Turns: { id: "Prompts", en: "Prompts" },
  Prompts: { id: "Prompts", en: "Prompts" },
  "API calls": { id: "Panggilan API", en: "API calls" },
  "API Call Limit": { id: "Batas Panggilan API", en: "API Call Limit" },
  "Input Tokens": { id: "Token Masuk (limit)", en: "Input Tokens (limit)" },
  "Output Tokens": { id: "Token Keluar", en: "Output Tokens" },
  "Est. Cost": { id: "Estimasi Biaya", en: "Est. Cost" },
  Sessions: { id: "Sesi", en: "Sessions" },
  "Tool Calls": { id: "Panggilan Alat", en: "Tool Calls" },
  "Create Key": { id: "Buat Kunci", en: "Create Key" },
  Trial: { id: "Percobaan", en: "Trial" },
  Phantom: { id: "Phantom", en: "Phantom" },
  Pro: { id: "Pro", en: "Pro" },
  Premium: { id: "Premium", en: "Premium" },
  Staff: { id: "Staff", en: "Staff" },
  "Add-on": { id: "Add-on", en: "Add-on" },
  "Add-on history": { id: "Riwayat Add-on", en: "Add-on history" },
  "Past and active pack assignments": {
    id: "Riwayat paket aktif dan yang sudah berakhir",
    en: "Past and active pack assignments",
  },
  "No add-on history yet": {
    id: "Belum ada riwayat add-on",
    en: "No add-on history yet",
  },
  Started: { id: "Mulai", en: "Started" },
  Expires: { id: "Berakhir", en: "Expires" },
  Status: { id: "Status", en: "Status" },
  "no expiry": { id: "tanpa batas", en: "no expiry" },
  Moderator: { id: "Moderator", en: "Moderator" },
  Troubleshooter: { id: "Troubleshooter", en: "Troubleshooter" },
  Contributor: { id: "Contributor", en: "Contributor" },
  Rekap: { id: "Rekap", en: "Recap" },
  Models: { id: "Model", en: "Models" },
  Logout: { id: "Keluar", en: "Logout" },
  Limit: { id: "Batas", en: "Limit" },
  Devices: { id: "Perangkat", en: "Devices" },
  Copy: { id: "Salin", en: "Copy" },
  Rotate: { id: "Rotasi", en: "Rotate" },
  Revoke: { id: "Cabut", en: "Revoke" },
  "API Keys": { id: "Kunci API", en: "API Keys" },
  "Your usage at a glance": { id: "Penggunaan kamu sekilas", en: "Your usage at a glance" },
  "Manage your API keys and devices": { id: "Kelola kunci API dan perangkat kamu", en: "Manage your API keys and devices" },
  "Recent API requests": { id: "Panggilan API terbaru", en: "Recent API calls" },
  "Manage your account": { id: "Kelola akun kamu", en: "Manage your account" },
  "Requests Over Time": { id: "Prompts Seiring Waktu", en: "Prompts Over Time" },
  "API Calls Over Time": { id: "Panggilan API Seiring Waktu", en: "API Calls Over Time" },
  "Prompts Over Time": { id: "Prompts Seiring Waktu", en: "Prompts Over Time" },
  "API Calls": { id: "Panggilan API", en: "API Calls" },
  "Token Usage by Model": { id: "Token (limit credit) per Model", en: "Limit Credit by Model" },
  "IDE Breakdown": { id: "Rincian IDE", en: "IDE Breakdown" },
  "Available Models": { id: "Model Tersedia", en: "Available Models" },
  "Models You've Used": { id: "Model yang Kamu Gunakan", en: "Models You've Used" },
  "Today vs Yesterday": { id: "Hari Ini vs Kemarin", en: "Today vs Yesterday" },
  "Top Errors": { id: "Error Terbanyak", en: "Top Errors" },
  "Usage Today": { id: "Penggunaan Hari Ini", en: "Usage Today" },
  "Daily Limit": { id: "Batas Harian", en: "Daily Limit" },
  "Monthly Limit": { id: "Batas Bulanan", en: "Monthly Limit" },
  "Forecast": { id: "Prakiraan", en: "Forecast" },
  "Quick Start": { id: "Mulai Cepat", en: "Quick Start" },
  "Language": { id: "Bahasa", en: "Language" },
  "Webhook URL": { id: "URL Webhook", en: "Webhook URL" },
  "Token Saver": { id: "Token Saver", en: "Token Saver" },
  "Token Saver desc": {
    id: "Pipeline hemat token sebelum request ke upstream: RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch. Default mengikuti admin. Pilih Default / Nyala / Mati per fitur. Header X-Token-Saver: off mematikan semua untuk 1 request.",
    en: "Token-saving pipeline before upstream: RTK → Groupy Compact → Headroom → Caveman → Ponytail → Batch. Defaults follow admin. Set Default / On / Off per feature. Header X-Token-Saver: off disables all for one request.",
  },
  Default: { id: "Default", en: "Default" },
  On: { id: "Nyala", en: "On" },
  Off: { id: "Mati", en: "Off" },
  Effect: { id: "Efek", en: "Effect" },
  Example: { id: "Contoh", en: "Example" },
  Risk: { id: "Risiko", en: "Risk" },
  "Show more": { id: "Selengkapnya", en: "Show more" },
  "RTK (tool compress)": { id: "RTK (compress tool)", en: "RTK (tool compress)" },
  "RTK desc": {
    id: "Memotong isi tool_result yang besar (git, grep, ls, read, shell…). Head+tail disimpan; tengah dibuang. Tidak menyentuh write/edit/apply_diff atau struktur tool_calls.",
    en: "Truncates huge tool_result dumps (git, grep, ls, read, shell…). Keeps head+tail; drops the middle. Never touches write/edit/apply_diff or tool_calls structure.",
  },
  "RTK effect": {
    id: "Efek: input ke model lebih kecil → kuota/token hemat di Cline/Roo/Kilo/OpenCode. Risiko: konteks tengah file panjang bisa hilang. Contoh: output `git status` 50KB → ~2KB (head+tail).",
    en: "Effect: smaller model input → saves quota on Cline/Roo/Kilo/OpenCode. Risk: middle of long dumps may be missing. Example: 50KB `git status` → ~2KB (head+tail).",
  },
  "Groupy Compact": { id: "Groupy Compact", en: "Groupy Compact" },
  "Groupy Compact desc": {
    id: "Smart trim untuk agent multi-hop: tool result terbaru tetap penuh; yang lama diganti stub berlabel sebelum ke upstream. Tidak hapus message / tidak sentuh write-edit.",
    en: "Smart trim for agent loops: keep the latest tool results full; stub older noisy dumps before upstream. Never deletes messages or touches write/edit results.",
  },
  "Groupy Compact effect": {
    id: "Efek: hemat besar di loop Cline/OpenCode 10–200 hop. Risiko: model bisa minta re-read file yang di-stub. Default ON (balanced).",
    en: "Effect: big savings on 10–200 hop Cline/OpenCode turns. Risk: model may re-read a stubbed file. Default ON (balanced).",
  },
  Headroom: { id: "Headroom", en: "Headroom" },
  "Headroom desc": {
    id: "Kirim messages ke layanan compress eksternal (URL di-set admin). Timeout 3 detik; gagal = request tetap jalan tanpa compress.",
    en: "POSTs messages to an external compress service (URL set by admin). 3s timeout; on failure the request continues uncompressed.",
  },
  "Headroom effect": {
    id: "Efek: context history lebih pendek jika URL aktif. Tanpa URL admin = tidak ada efek meski Nyala. Contoh: 40 pesan history → ~15 pesan ringkas.",
    en: "Effect: shorter conversation context when admin URL is set. Without a URL, enabling does nothing. Example: 40 history messages → ~15 compressed.",
  },
  Caveman: { id: "Caveman", en: "Caveman" },
  "Caveman desc": {
    id: "Menyisipkan system prompt agar model menjawab lebih singkat (level 1–5 di-set admin). Tidak mengubah tool calls.",
    en: "Injects a system prompt so the model replies more tersely (admin sets level 1–5). Does not change tool calls.",
  },
  "Caveman effect": {
    id: "Efek: output tokens turun. Risiko: gaya jawaban kasar/telegram; bisa mengganggu agent yang butuh penjelasan panjang. Default OFF. Contoh: paragraf panjang → 2–3 kalimat singkat.",
    en: "Effect: fewer output tokens. Risk: terse/telegram style; can hurt agents that need long explanations. Default OFF. Example: long paragraph → 2–3 short sentences.",
  },
  Ponytail: { id: "Ponytail", en: "Ponytail" },
  "Ponytail desc": {
    id: "System prompt anti-basa-basi untuk agent IDE: skip \"Sure!\", skip ulang rencana, langsung aksi (level lite/full/ultra di admin).",
    en: "Anti-boilerplate system prompt for IDE agents: skip \"Sure!\", skip plan restatements, act directly (admin lite/full/ultra).",
  },
  "Ponytail effect": {
    id: "Efek: loop Cline/Roo lebih hemat token chat. Risiko: kurang narasi/status. Default OFF. Contoh: skip \"I'll read the file now…\" → langsung tool call.",
    en: "Effect: leaner Cline/Roo agent loops. Risk: less narration/status text. Default OFF. Example: skip \"I'll read the file now…\" → go straight to tool call.",
  },
  Batch: { id: "Batch", en: "Batch" },
  "Batch desc": {
    id: "Menyisipkan system prompt agar model minta beberapa read/edit sekaligus dalam 1 balasan (parallel tool_calls), bukan satu file per giliran. Tidak mengubah kemampuan model, cuma mengurangi jumlah kali hit ke upstream.",
    en: "Injects a system prompt telling the model to request several reads/edits together in ONE reply (parallel tool_calls) instead of one file per turn. Does not change what the model can do — only how many hits it takes.",
  },
  "Batch effect": {
    id: "Efek: lebih sedikit hop → history yang dikirim ulang lebih jarang → hemat token & biaya. Contoh: butuh 5 file → sebelumnya 5x baca terpisah (5 hit) → sesudah: diminta sekaligus (1 hit). Langkah yang memang harus lihat hasil dulu (edit → run test → baca error → perbaiki) tidak berubah — itu bukan hal yang bisa dihemat lewat prompt. Beda model beda hasil: Grok/Claude Opus sudah sering batch sendiri; GLM/Gemini Flash biasanya butuh dorongan ini. Default ON.",
    en: "Effect: fewer hops → growing history resent less often → real token & cost savings. Example: task needs 5 files → was 5 separate reads (5 hits) → now requested together (1 hit). Steps that genuinely need to see a result first (edit → run test → read error → fix) are unaffected — that can't be shortcut by a prompt. Impact varies by model: Grok/Claude Opus already batch a lot on their own; GLM/Gemini Flash usually need this nudge. Default ON.",
  },
  "Live Updates": { id: "Pembaruan Langsung", en: "Live Updates" },
  "Portal Password": { id: "Kata Sandi Portal", en: "Portal Password" },
  Account: { id: "Akun", en: "Account" },
  "Discord Username": { id: "Nama Discord", en: "Discord Username" },
  "Last Login": { id: "Login Terakhir", en: "Last Login" },
  "Token Multiplier": { id: "Pengganda Token", en: "Token Multiplier" },
  "Trial expires in": { id: "Percobaan berakhir dalam", en: "Trial expires in" },
  days: { id: "hari", en: "days" },
  hours: { id: "jam", en: "hours" },
  "View Recap": { id: "Lihat Rekap", en: "View Recap" },
  "Recap opens on": { id: "Rekap dibuka pada", en: "Recap opens on" },
  "Recap is almost ready": { id: "Rekap hampir siap", en: "Recap is almost ready" },
  "Recap ready in days": {
    id: "Rekap kamu siap dalam {n} hari lagi.",
    en: "Your recap will be ready in {n} days.",
  },
  "Recap opens soon": {
    id: "Rekap sebentar lagi dibuka.",
    en: "Recap opens soon.",
  },
  "Opens on": { id: "Dibuka", en: "Opens on" },
  until: { id: "sampai", en: "until" },
  "Got it": { id: "Mengerti", en: "Got it" },
  "Your monthly recap is ready": {
    id: "Recap bulanan kamu sudah siap",
    en: "Your monthly recap is ready",
  },
  "Open your Wrapped-style coding story for this month.": {
    id: "Buka cerita ngoding bergaya Wrapped untuk bulan ini.",
    en: "Open your Wrapped-style coding story for this month.",
  },
  Close: { id: "Tutup", en: "Close" },
  "Show now": { id: "Tampilkan sekarang", en: "Show now" },
  "Failed to open recap": {
    id: "Gagal membuka rekap",
    en: "Failed to open recap",
  },
  Notifications: { id: "Notifikasi", en: "Notifications" },
  "No notifications": { id: "Tidak ada notifikasi", en: "No notifications" },
  "Mark all read": { id: "Tandai semua dibaca", en: "Mark all read" },
  "Loading...": { id: "Memuat...", en: "Loading..." },
  Online: { id: "Online", en: "Online" },
  Offline: { id: "Offline", en: "Offline" },
  Unknown: { id: "Tidak Diketahui", en: "Unknown" },
  "Allowed": { id: "Diizinkan", en: "Allowed" },
  "Copied!": { id: "Tersalin!", en: "Copied!" },
  Cancel: { id: "Batal", en: "Cancel" },
  Save: { id: "Simpan", en: "Save" },
  "Set Password": { id: "Atur Kata Sandi", en: "Set Password" },
  "Update Password": { id: "Perbarui Kata Sandi", en: "Update Password" },
  "Remove password": { id: "Hapus kata sandi", en: "Remove password" },
  "Change password": { id: "Ganti kata sandi", en: "Change password" },
  "Forecast ETA": { id: "Perkiraan Batas", en: "Forecast ETA" },
  "at current rate": { id: "pada laju saat ini", en: "at current rate" },
  "No limits configured": { id: "Tidak ada batas yang dikonfigurasi", en: "No limits configured" },
  "Endpoint Cheat Sheet": { id: "Panduan Endpoint", en: "Endpoint Cheat Sheet" },
  "Base URL": { id: "URL Dasar", en: "Base URL" },
  "Key rotated": { id: "Kunci dirotasi", en: "Key rotated" },
  "New key created": { id: "Kunci baru dibuat", en: "New key created" },
  "Confirm rotate": { id: "Konfirmasi rotasi", en: "Confirm rotate" },
  "Confirm delete": { id: "Konfirmasi hapus", en: "Confirm delete" },
  "Are you sure you want to delete this API key? This cannot be undone.": {
    id: "Yakin ingin menghapus API key ini? Tindakan ini tidak bisa dibatalkan.",
    en: "Are you sure you want to delete this API key? This cannot be undone.",
  },
  Delete: { id: "Hapus", en: "Delete" },
  "Extra keys share the same Discord usage limits — they do not add extra quota.": {
    id: "Key tambahan memakai limit & usage Discord yang sama — tidak menambah kuota.",
    en: "Extra keys share the same Discord usage limits — they do not add extra quota.",
  },
  "Confirm revoke": { id: "Konfirmasi cabut", en: "Confirm revoke" },
  "Model status and usage": { id: "Status dan penggunaan model", en: "Model status and usage" },
  "Last check": { id: "Cek terakhir", en: "Last check" },
  "Never checked": { id: "Belum pernah dicek", en: "Never checked" },
  "just now": { id: "baru saja", en: "just now" },
  "min ago": { id: "menit lalu", en: "min ago" },
  ago: { id: "lalu", en: "ago" },
  All: { id: "Semua", en: "All" },
  Sort: { id: "Urutkan", en: "Sort" },
  Fastest: { id: "Tercepat (latency)", en: "Fastest (latency)" },
  "Name A-Z": { id: "Nama A–Z", en: "Name A–Z" },
  "Catalog order": { id: "Urutan katalog", en: "Catalog order" },
  Provider: { id: "Provider", en: "Provider" },
  "All providers": { id: "Semua provider", en: "All providers" },
  "Search models": { id: "Cari model…", en: "Search models…" },
  shown: { id: "ditampilkan", en: "shown" },
  "Show less": { id: "Tampilkan lebih sedikit", en: "Show less" },
  Show: { id: "Tampilkan", en: "Show" },
  more: { id: "lagi", en: "more" },
  Period: { id: "Periode", en: "Period" },
  "No models found": { id: "Tidak ada model", en: "No models found" },
  "No usage in this period": { id: "Tidak ada penggunaan di periode ini", en: "No usage in this period" },
  Source: { id: "Sumber", en: "Source" },
  override: { id: "override user", en: "user override" },
  global: { id: "global", en: "global" },
  "Prompt Limit": { id: "Batas Prompt", en: "Prompt Limit" },
  "Rate Limit": { id: "Batas Panggilan API", en: "API Call Limit" },
  "Click for details": { id: "Klik untuk detail", en: "Click for details" },
  Request: { id: "Request", en: "Request" },
  "Upstream response": { id: "Respons upstream", en: "Upstream response" },
  "Copy for AI": { id: "Salin untuk AI", en: "Copy for AI" },
  Input: { id: "Input", en: "Input" },
  Output: { id: "Output", en: "Output" },
  Error: { id: "Error", en: "Error" },
  "Per-Model Prompt": { id: "Prompt per Model", en: "Per-Model Prompt" },
  Resets: { id: "Reset", en: "Resets" },
  "Are you sure you want to rotate this key? Your old key will be immediately invalidated.": {
    id: "Yakin ingin merotasi kunci ini? Kunci lama akan langsung tidak berlaku.",
    en: "Are you sure you want to rotate this key? Your old key will be immediately invalidated.",
  },
  "Are you sure you want to revoke this device? It will no longer be able to use this key.": {
    id: "Yakin ingin mencabut perangkat ini? Perangkat tidak bisa lagi menggunakan kunci ini.",
    en: "Are you sure you want to revoke this device? It will no longer be able to use this key.",
  },
};

let _lang: Lang = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "id" || stored === "en") return stored;
  } catch { /* ignore */ }
  return "id";
})();

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return _lang;
}

export function setLang(lang: Lang): void {
  _lang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export function t(key: string): string {
  return dict[key]?.[_lang] ?? key;
}

export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string } {
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  return { lang: _lang, setLang, t };
}
