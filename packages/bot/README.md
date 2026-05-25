# Antigravity Verification System

Sistem verifikasi antigravity untuk Discord bot menggunakan foto wajah dengan kertas bertulisan khusus.

## Fitur

### Core Features
- ✅ Private thread per user untuk verifikasi
- ✅ Require role "The Phantom" untuk membuat tiket
- ✅ Upload foto selfie + kertas bertulisan verifikasi
- ✅ Auto-tag Owner Groupy setelah foto diupload
- ✅ Auto-detect role assignment setelah verifikasi
- ✅ Full tracking dari upload sampai verified

### Protection & Security
- ✅ Periodic photo check setiap 6 jam
- ✅ Auto revoke role jika foto dihapus setelah verifikasi
- ✅ Auto delete thread jika tidak upload foto dalam 1 jam
- ✅ Thread dihapus setelah 3 hari jika foto tidak diupload ulang
- ✅ Anti multi-upload (hanya 1 foto per verifikasi)

### Smart Photo Deletion Handling
**Jika foto dihapus SEBELUM dapat role:**
- Kasih peringatan ke user
- Suruh upload ulang di thread yang sama
- Thread tetap aktif, tunggu 3 hari auto-hide
- Jika upload ulang: tag Owner Groupy lagi

**Jika foto dihapus SETELAH dapat role:**
- Cabut role langsung
- Kasih peringatan bahwa role telah dicabut
- User bisa:
  1. Upload ulang di thread yang sama (tag Owner Groupy lagi)
  2. Buat tiket baru (thread lama auto-delete)
- Thread dihapus setelah 3 hari jika tidak ada foto baru
- Hide inactivity tetap 3 hari (bukan 1 jam)

### Timeouts
- **1 jam**: Delete thread jika belum upload foto
- **3 hari**: Auto-hide setelah inactive
- **3 hari**: Delete thread jika foto dihapus dan tidak upload ulang

## Konfigurasi

Edit di file `.env`:

```env
BOT_TOKEN=your_bot_token_here
AGVERIF_CHANNEL_ID=1470106180255744123
REQUIRED_ROLE_ID=1354646304042651728
OWNER_GROUPY_ROLE_ID=1354642878063710260
VERIFIED_ROLE_ID=1470293191965020160
```

Atau hardcode di `agverif.js`:

```javascript
const AGVERIF_CHANNEL_ID = '1470106180255744123';
const REQUIRED_ROLE_ID = '1354646304042651728';
const OWNER_GROUPY_ROLE_ID = '1354642878063710260';
const VERIFIED_ROLE_ID = '1470293191965020160';
```

## Database

Sistem menggunakan 3 file JSON:

### `agverif_data/threads.json`
```json
{
  "threadId": {
    "userId": "string",
    "createdAt": "timestamp",
    "hasPhoto": "boolean",
    "photoMessageId": "string | null",
    "verifiedBy": "string | null",
    "verifiedAt": "timestamp | null",
    "hasRole": "boolean",
    "lastPhotoCheck": "timestamp",
    "photoDeletedAfterRole": "boolean",
    "warningMessageSent": "boolean"
  }
}
```

### `agverif_data/verified_users.json`
```json
{
  "userId": {
    "threadId": "string",
    "verifiedAt": "timestamp",
    "roleId": "string"
  }
}
```

### `agverif_data/setup_state.json`
```json
{
  "messageId": "string | null",
  "channelId": "string | null"
}
```

## Cara Kerja

### 1. Bot Startup
- Bot otomatis kirim embed dengan button verifikasi di channel
- Jika embed sudah ada, bot akan update (tidak duplikat)
- Jika embed tidak bisa diakses, bot buat baru

### 2. User Buat Tiket
- User klik button "🔐 Verifikasi Antigravity"
- Syarat: Harus punya role "The Phantom"
- Bot buat private thread untuk user

### 3. Upload Foto
- User upload foto selfie + kertas bertulisan:
  > "saya pengguna paket phantom, ingin verifikasi antigravity"
- Bot tag Owner Groupy
- Timer 1 jam dibersihkan

### 4. Verifikasi
- Owner Groupy cek foto
- Jika valid, kasih role manual
- Bot auto-detect dan kirim notifikasi sukses

### 5. Foto Dihapus (Before Role)
- Bot kasih peringatan
- Suruh upload ulang
- Jika upload ulang: tag Owner Groupy lagi
- Thread tetap aktif

### 6. Foto Dihapus (After Role)
- Bot cabut role langsung
- Kasih peringatan + opsi:
  1. Upload ulang (tag Owner Groupy)
  2. Buat tiket baru (thread lama dihapus)
- Thread dihapus setelah 3 hari jika tidak upload ulang

### 7. Buat Tiket Baru
- Jika user buat tiket baru saat ada thread lama
- Bot tolak dan suruh tutup thread lama dulu
- Atau user bisa tutup/hapus thread lama manual

## Dependencies

```json
{
  "discord.js": "^14.14.1",
  "dotenv": "^16.4.1"
}
```

## License

MIT License - Groupy Project
