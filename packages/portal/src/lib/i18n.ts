import { useState, useEffect } from "react";

export type Lang = "id" | "en";

const STORAGE_KEY = "portal_lang";

const dict: Record<string, Record<Lang, string>> = {
  Overview: { id: "Ringkasan", en: "Overview" },
  Keys: { id: "Kunci API", en: "Keys" },
  Activity: { id: "Aktivitas", en: "Activity" },
  Settings: { id: "Pengaturan", en: "Settings" },
  Requests: { id: "Permintaan", en: "Requests" },
  "Input Tokens": { id: "Token Masuk", en: "Input Tokens" },
  "Output Tokens": { id: "Token Keluar", en: "Output Tokens" },
  "Est. Cost": { id: "Estimasi Biaya", en: "Est. Cost" },
  Sessions: { id: "Sesi", en: "Sessions" },
  "Tool Calls": { id: "Panggilan Alat", en: "Tool Calls" },
  "Create Key": { id: "Buat Kunci", en: "Create Key" },
  Trial: { id: "Percobaan", en: "Trial" },
  Phantom: { id: "Phantom", en: "Phantom" },
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
  "Recent API requests": { id: "Permintaan API terbaru", en: "Recent API requests" },
  "Manage your account": { id: "Kelola akun kamu", en: "Manage your account" },
  "Requests Over Time": { id: "Permintaan Seiring Waktu", en: "Requests Over Time" },
  "Token Usage by Model": { id: "Penggunaan Token per Model", en: "Token Usage by Model" },
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
    id: "Pipeline hemat token sebelum request ke upstream: RTK → Headroom → Caveman → Ponytail. Default mengikuti admin. Pilih Default / Nyala / Mati per fitur. Header X-Token-Saver: off mematikan semua untuk 1 request.",
    en: "Token-saving pipeline before upstream: RTK → Headroom → Caveman → Ponytail. Defaults follow admin. Set Default / On / Off per feature. Header X-Token-Saver: off disables all for one request.",
  },
  Default: { id: "Default", en: "Default" },
  On: { id: "Nyala", en: "On" },
  Off: { id: "Mati", en: "Off" },
  "RTK (tool compress)": { id: "RTK (compress tool)", en: "RTK (tool compress)" },
  "RTK desc": {
    id: "Memotong isi tool_result yang besar (git, grep, ls, read, shell…). Head+tail disimpan; tengah dibuang. Tidak menyentuh write/edit/apply_diff atau struktur tool_calls.",
    en: "Truncates huge tool_result dumps (git, grep, ls, read, shell…). Keeps head+tail; drops the middle. Never touches write/edit/apply_diff or tool_calls structure.",
  },
  "RTK effect": {
    id: "Efek: input ke model lebih kecil → kuota/token hemat di Cline/Roo/Kilo/OpenCode. Risiko: konteks tengah file panjang bisa hilang. Contoh: output `git status` 50KB → ~2KB (head+tail).",
    en: "Effect: smaller model input → saves quota on Cline/Roo/Kilo/OpenCode. Risk: middle of long dumps may be missing. Example: 50KB `git status` → ~2KB (head+tail).",
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
  Notifications: { id: "Notifikasi", en: "Notifications" },
  "No notifications": { id: "Tidak ada notifikasi", en: "No notifications" },
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
  "Rate Limit": { id: "Batas Rate", en: "Rate Limit" },
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
