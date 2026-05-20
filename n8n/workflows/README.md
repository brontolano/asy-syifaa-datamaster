# N8N Workflow Templates - PPDB

## File
- `ppdb-wa-notify-n8n-template.json`
- `ppdb-wa-notify-n8n-waha-template.json`

## Tujuan
Workflow ini menerima webhook PPDB dari backend Asy-Syifaa, validasi payload, kirim WhatsApp via provider, lalu merespons status ke caller.

## Cara Import ke N8N
1. Buka N8N.
2. `Workflows` -> `Import from File`.
3. Pilih file template:
   - `ppdb-wa-notify-n8n-waha-template.json` (direkomendasikan untuk WAHA)
   - `ppdb-wa-notify-n8n-template.json` (multi-provider generic)
4. Simpan workflow.
5. Aktifkan workflow.

## Endpoint Webhook Workflow
- Path: `/webhook/ppdb-wa`
- Method: `POST`

Contoh URL produksi:
- `https://n8n.domain-anda/webhook/ppdb-wa`

Set URL ini di backend `apps/backend/.env` (opsi WAHA direct tanpa N8N):
- `PPDB_WA_NOTIFY_ENABLED=true`
- `PPDB_WA_NOTIFY_PROVIDER=waha`
- `PPDB_WA_NOTIFY_ENDPOINT=https://waha.devlike.pro/api/sendText`
- `PPDB_WA_NOTIFY_TOKEN=<api-key-jika-dipakai>`
- `PPDB_WA_SESSION=default`
- `PPDB_PUBLIC_WEBSITE_BASE_URL=https://asy-syifaa.com`

Set URL ini di backend `apps/backend/.env` (opsi via N8N webhook):
- `PPDB_WA_NOTIFY_ENABLED=true`
- `PPDB_WA_NOTIFY_PROVIDER=generic`
- `PPDB_WA_NOTIFY_ENDPOINT=https://n8n.domain-anda/webhook/ppdb-wa`
- `PPDB_PUBLIC_WEBSITE_BASE_URL=https://asy-syifaa.com`

## Environment Variables di N8N
Tambahkan env pada service/container N8N:

- `N8N_WA_PROVIDER=waha` (`waha` | `fonnte` | `wablas` | `generic`)
- `N8N_WA_TOKEN=<token provider>`
- `N8N_WA_ENDPOINT=<url gateway WA>`
- `N8N_WA_SESSION=default`
- `N8N_WAHA_BASE_URL=https://waha.devlike.pro`
- `N8N_WAHA_API_KEY=<api-key-jika-dipakai>`
- `N8N_WAHA_SESSION=default`

Catatan:
- `fonnte`: jika `N8N_WA_ENDPOINT` kosong, default `https://api.fonnte.com/send`.
- `wablas`: endpoint wajib diisi.
- `generic`: endpoint wajib diisi.
- Template WAHA memakai endpoint `{{N8N_WAHA_BASE_URL}}/api/sendText` dan header `X-Api-Key` jika key tersedia.

## Payload Masuk dari Backend
```json
{
  "to": "6281234567890",
  "message": "Assalamu'alaikum ...",
  "eticket_no": "ETK-20260519-000001",
  "student_name": "Nama Calon Santri",
  "source": "ppdb_register"
}
```

## Payload Response dari Workflow
```json
{
  "ok": true,
  "provider": "fonnte",
  "sent": true,
  "reason": "sent",
  "eticket_no": "ETK-20260519-000001",
  "student_name": "Nama Calon Santri",
  "to": "6281234567890"
}
```
