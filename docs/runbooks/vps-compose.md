# Compose terpisah di VPS

Pola deployment ini menyediakan Compose **terpisah** untuk
[PostgreSQL](../../database/docker-compose.postgres.yaml),
[API + queue worker](../../apps/api/compose.yaml), dan
[web](../../apps/web/compose.yaml). Image aplikasi berasal dari
[CI GHCR](../../.github/workflows/images.yml); Compose tidak membangun ulang
image pada VPS. Root [`compose.yaml`](../../compose.yaml) hanya untuk PostgreSQL,
n8n, dan Mailpit **lokal**. Gunakan file di bawah hanya pada target dan jendela
deployment yang sudah disetujui; tidak ada stack produksi yang dijalankan saat
menyiapkan runbook ini.

Hosting utama tetap **Vercel (web), Cloudflare Workers (API), dan PostgreSQL di
VPS**. Compose web/API adalah pilihan bila masing-masing aplikasi dipindahkan
ke VPS; jangan nyalakan API dan queue worker Docker bersamaan dengan API/Cron
Workers tanpa cutover yang ditinjau. n8n produksi belum dikonfigurasi oleh
Compose ini.

## Persiapan operator

1. Periksa arsitektur VPS (`uname -m`), image `linux/amd64` di GHCR, kapasitas
   disk, backup PostgreSQL dan kunci enkripsi, serta siapa yang menggunakan port
   host 3010/3011. Pertahankan nama project `esim-erp-postgres`: nama baru akan
   memilih volume database baru, **bukan** memindahkan data lama. Volume dari
   root Compose lokal juga tidak dipakai otomatis oleh Compose VPS ini.
2. Siapkan jaringan Docker khusus ERP `esim-erp-network` (`docker network
   inspect esim-erp-network`; buat dengan `docker network create
   esim-erp-network` hanya jika belum ada dan memang akan deploy). Akses jaringan
   ini hanya untuk layanan ERP/ingress yang dipercaya.
3. Buat file konfigurasi operator **di luar Git**, dengan izin terbatas. File
   Compose DB berisi `POSTGRES_USER` (owner migrasi), `POSTGRES_DB`,
   `POSTGRES_PASSWORD_FILE` (path absolut file password),
   `POSTGRES_TLS_CERT_DIR` (path absolut direktori `fullchain.pem` dan
   `privkey.pem`), dan `POSTGRES_DNS_NAME` (hostname DNS yang tercakup sertifikat
   TLS). Password file hanya dipakai untuk **inisialisasi volume baru**; mengubah
   file tidak mengganti password database existing.
4. Sediakan sertifikat PostgreSQL dari CA yang dipercaya client dan cocok dengan
   `POSTGRES_DNS_NAME`. Mount direktori sertifikat read-only; `privkey.pem` harus
   dapat dibaca oleh user `postgres` dalam image, dengan permission sesuai
   PostgreSQL (misalnya owner user server mode 0600, atau owner root/group server
   mode 0640). Target symlink juga harus berada di direktori yang di-mount.
   Konfigurasi [`pg_hba.conf`](../../database/pg_hba.conf) mewajibkan TLS dan
   autentikasi SCRAM untuk semua koneksi TCP, termasuk dari kontainer API.
5. File Compose API (non-secret) memuat `BACKEND_IMAGE` dan `API_ENV_FILE`;
   file Compose web memuat `FRONTEND_IMAGE` dan `WEB_ENV_FILE`. Pilih image
   `ghcr.io/<owner>/<repo>/backend:sha-<FULL_COMMIT_SHA>` dan
   `ghcr.io/<owner>/<repo>/frontend:sha-<FULL_COMMIT_SHA>` hasil CI yang sudah
   ditinjau, atau digest immutable; gunakan **SHA pasangan yang sama**. File
   runtime privat web berisi `API_ORIGIN`, `WEB_ORIGIN`,
   `ERP_PROXY_SECRET`; runtime API berisi `DATABASE_URL`, `WEB_ORIGIN`,
   `ERP_PROXY_SECRET`, `ESIM_ENCRYPTION_KEY`, `AUTOMATION_TOKEN`, dan opsional
   `MIDTRANS_SERVER_KEY` **sandbox**. Compose memaksa `APP_ENV=production` dan
   menonaktifkan simulasi pembayaran. Jangan taruh secrets di file Compose atau
   file konfigurasi yang di-commit. Docker admin dapat membaca environment
   kontainer; batasi akses host dan file runtime.

Format `DATABASE_URL` untuk runtime, migration job, dan Workers:

```text
postgresql://<DB_USER>:<DB_PASSWORD>@<POSTGRES_DNS_NAME>:5432/<POSTGRES_DB>?sslmode=verify-full
```

Gunakan role runtime dengan izin yang diperlukan saja; migration job memakai
file environment **terpisah** milik operator dengan `DATABASE_URL` role owner.
Encode karakter khusus dalam URL. Kontainer API menggunakan alias Docker
`POSTGRES_DNS_NAME` pada `esim-erp-network`, sehingga hostname koneksi tetap
cocok dengan sertifikat. Worker menggunakan DNS publik dengan hostname yang
sama; tidak dapat menjangkau IP Docker/loopback secara langsung. Bila port host
Worker berbeda dari 5432, URL Workers memakai port host itu, sedangkan URL
kontainer API/migration job tetap memakai port internal 5432.

## Urutan rilis (dijalankan operator dari root repository)

Ganti semua path di bawah dengan file privat yang telah disiapkan di luar
repository. `config --quiet` memeriksa Compose tanpa mencetak nilai environment
dari `env_file`; `config` biasa dapat menampilkan secrets. Jangan menjalankan
`up` sebelum database existing di-backup, migrasi direhearsal pada salinan,
dan akses produksi disetujui.

```sh
DB_VARS=/ABS/PATH/db-compose.env
API_VARS=/ABS/PATH/api-compose.env
WEB_VARS=/ABS/PATH/web-compose.env

docker compose -p esim-erp-postgres --env-file "$DB_VARS" \
  -f database/docker-compose.postgres.yaml config --quiet
docker compose -p esim-erp-postgres --env-file "$DB_VARS" \
  -f database/docker-compose.postgres.yaml up -d --wait

# Untuk backend Docker atau Workers, jalankan migrasi satu kali memakai image
# backend versi target dan file owner terpisah setelah backup/approval. Jangan seed.
docker run --rm --network esim-erp-network \
  --env-file /ABS/PATH/maintenance.env \
  ghcr.io/<owner>/<repo>/backend:sha-<FULL_COMMIT_SHA> \
  bun /app/migrate.js

docker compose -p esim-erp-api --env-file "$API_VARS" \
  -f apps/api/compose.yaml config --quiet
docker compose -p esim-erp-api --env-file "$API_VARS" \
  -f apps/api/compose.yaml up -d --wait

docker compose -p esim-erp-web --env-file "$WEB_VARS" \
  -f apps/web/compose.yaml config --quiet
docker compose -p esim-erp-web --env-file "$WEB_VARS" \
  -f apps/web/compose.yaml up -d --wait
```

Jika API tetap di Workers, gunakan runner migrasi image backend dengan akses DB
yang disetujui sebelum deploy Worker; **lewati** `up` untuk API Docker, dan
biarkan Cron Workers menangani antrean. Jika web tetap di Vercel, **lewati**
Compose web. Compose menerbitkan web/API ke **127.0.0.1 saja** di port
3010/3011; atur reverse proxy HTTPS terpisah bila memakai hosting VPS. Repo
ini tidak membuat DNS, sertifikat HTTPS web/API, firewall, atau service n8n
produksi.

## Akses PostgreSQL dari Workers (opsional, butuh review jaringan)

Compose database dasar **tidak** memublikasikan port. Untuk Worker yang memakai
`DATABASE_URL` langsung, operator harus menyediakan rute TCP dari Cloudflare ke
VPS. [`docker-compose.worker-access.yaml`](../../database/docker-compose.worker-access.yaml)
merupakan opsi eksplisit: setelah memverifikasi TLS, autentikasi, sertifikat,
DNS publik, aturan firewall dan backup, isi `POSTGRES_LISTEN_ADDRESS` dengan
interface VPS yang disetujui (serta `POSTGRES_LISTEN_PORT` bila bukan 5432)
pada file `DB_VARS`, kemudian gunakan **kedua** file Compose dengan project
`esim-erp-postgres` yang sama:

```sh
docker compose -p esim-erp-postgres --env-file "$DB_VARS" \
  -f database/docker-compose.postgres.yaml \
  -f database/docker-compose.worker-access.yaml config --quiet
docker compose -p esim-erp-postgres --env-file "$DB_VARS" \
  -f database/docker-compose.postgres.yaml \
  -f database/docker-compose.worker-access.yaml up -d --wait
```

Jangan gunakan daftar IP **proxy** Cloudflare sebagai egress Workers: itu tidak
mewakili alamat sumber koneksi database. Jika egress Worker tidak punya daftar
IP tetap, port publik akan terlihat oleh internet meski TLS/SCRAM aktif;
pilih pengamanan jaringan lain atau terima risiko tersebut secara sadar sebelum
membukanya. Jangan menambahkan override ini pada root Compose lokal.

## Cek dan pemulihan

- `docker compose ... ps` harus menunjukkan PostgreSQL dan API/web yang dipilih
  `healthy`, serta worker `running`. Cek API `/health` untuk liveness dan
  `/ready` untuk koneksi DB; healthcheck Compose sendiri **tidak** membuktikan
  koneksi DB. Di VPS alternatif, akses hanya lewat loopback/proxy HTTPS.
- Verifikasi dengan client PostgreSQL `sslmode=verify-full` pada hostname dan
  port yang benar (positif); percobaan TCP `sslmode=disable` harus ditolak oleh
  `pg_hba.conf` (negatif). Uji rute ERP berizin melalui web; jangan menganggap
  `/health` sebagai bukti alur bisnis atau koneksi Workers ke VPS.
- Sebelum migrasi, ambil backup terenkripsi di luar host dan uji restore
  terisolasi. Migrasi SQL dapat mengunci penulisan; jadwalkan pada trafik
  rendah dan periksa jurnal migrasi bila gagal. Pembaruan image pakai SHA/digest
  baru dengan project/volume tetap; versi backend lama tidak mengenali status
  order `cancelled`, jadi rollback aplikasi ke versi lama tidak aman setelah
  pembatalan tercatat. DB rollback/restore perlu keputusan terpisah agar data
  setelah backup tidak hilang.
- `docker compose ... stop` menghentikan layanan tanpa menghapus volume.
  **Jangan** gunakan `down -v` terhadap project database maupun local.

Runbook ini hanya mempersiapkan konfigurasi; status GHCR, konektivitas Workers,
backup/restore, dan deployment VPS belum diverifikasi pada infrastruktur live.
