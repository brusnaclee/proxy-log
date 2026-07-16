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
  "Confirm revoke": { id: "Konfirmasi cabut", en: "Confirm revoke" },
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
