# Repository Harness untuk eSIM ERP

Repository menggunakan core dari
[hoangnb24/repository-harness](https://github.com/hoangnb24/repository-harness),
dipasang dari revisi
[`485fd40`](https://github.com/hoangnb24/repository-harness/commit/485fd4062be1c71b27c1c9e5585ac4cd2faa7e06).
Binary melaporkan versi **0.1.10**. Lisensi upstream dipertahankan di
[REPOSITORY-HARNESS-LICENSE](REPOSITORY-HARNESS-LICENSE).

## Batas pemasangan

- Installer resmi dijalankan dengan `--merge --refresh-agent-shim --yes`,
  setelah preview `--dry-run`; tidak menggunakan `--override` atau `--force`.
- Core mengelola 26 path melalui `.harness-core/manifest.json` dan baseline
  `.harness-core/base/`. Baseline tersebut milik updater, bukan source untuk
  diedit atau diformat oleh linter aplikasi.
- Panduan engineering existing tetap utuh. `AGENTS.md` mendapat satu blok
  `HARNESS:BEGIN`/`HARNESS:END`; dokumentasi map disesuaikan dengan monorepo ERP.
- Empat skill upstream tersedia khusus repository: `onboard-repository`,
  `audit-onboarding-proposal`, `encode-invariant`, dan `improve-harness`.
  Nama, frontmatter, dan helper dipertahankan agar sesuai manifest upstream.
  Skill hanya dipanggil jika pengguna memintanya secara eksplisit.
- Tidak memasang engineering-wisdom, SQLite task database, workflow release
  upstream, hook global, atau konfigurasi agen global.
- Installer tidak membuat commit, remote, push, deploy, atau migrasi database.
  Pemeriksaan hash menunjukkan hanya `AGENTS.md` dan `.gitignore` berubah dari
  175 file existing saat pemasangan; source dan konfigurasi privat tidak berubah.

Product contract, rencana implementasi, serta perintah aplikasi tetap dimiliki
ERP. Gunakan [documentation map](README.md) untuk menemukan source tersebut.
Harness tidak menggantikan `.agents/general.md`, `.agents/preferences.md`,
profil bahasa/framework, atau aturan ReUI.

## Pemeriksaan dari root repository

```sh
scripts/bin/harness --version
scripts/bin/harness status
scripts/bin/harness doctor
```

`doctor` harus lulus pemeriksaan provenance, path, Git merge-file, transaksi
terputus, dan konflik update. `status` dapat melaporkan `modified` untuk
`AGENTS.md` serta indeks docs yang memang diadaptasi; ini bukan missing file
atau izin menimpa perubahan lokal. Pemeriksaan ini tidak membuktikan payment,
database, atau frontend berjalan; gunakan perintah verifikasi di README ERP.

## Memulihkan binary pada checkout baru

`scripts/bin/harness` adalah binary lokal yang tidak masuk Git. Build ulang dari
sumber yang dipin dengan Git, Bash, Rust, dan Cargo yang tersedia. Perintah
berikut mengunduh source dan dapat mengisi cache Cargo, lalu melakukan preview:

```sh
HARNESS_SOURCE="$(mktemp -d)"
git clone https://github.com/hoangnb24/repository-harness "$HARNESS_SOURCE"
git -C "$HARNESS_SOURCE" checkout --detach 485fd4062be1c71b27c1c9e5585ac4cd2faa7e06
bash "$HARNESS_SOURCE/scripts/install-harness.sh" \
  --directory "$PWD" --merge --refresh-agent-shim --yes --dry-run
```

Tinjau preview sebelum menjalankan perintah installer yang sama tanpa
`--dry-run`. Pada repository dengan manifest existing, `--merge` menjalankan
update berbasis three-way merge, bukan sekadar menambah file yang belum ada.
Jangan menimpa konflik atau perubahan pengguna. Setelah selesai, hapus hanya
checkout temporary yang dibuat untuk prosedur ini, lalu jalankan `doctor`.

## Update dan recovery

Pada saat pemasangan, rilis `harness-v0.1.10` berada tiga commit di belakang
revisi `main` yang digunakan, meskipun keduanya memakai nomor versi 0.1.10.
Karena itu, jangan menjalankan update mutating ke kandidat rilis tanpa meninjau
revisi dan diff; perbandingan nomor versi saja tidak mendeteksi kemunduran isi.
Gunakan kandidat sumber terverifikasi, preview, dan persetujuan untuk scope
update tersebut.

Pertahankan `.harness-core/manifest.json` dan baseline-nya bersama source.
Jika updater melaporkan konflik, baca staging/resolution yang disebut CLI;
selesaikan isi secara eksplisit sebelum melanjutkan. Jika transaksi terputus,
ikuti diagnosis `doctor`, bukan menghapus direktori state.

Backup installer di `.harness-backup/` dikecualikan dari Git. Pertahankan backup
AGENTS jika diperlukan untuk recovery; jangan mempublikasikan private guidance.
Binary dan state transient juga dikecualikan dari Git. Tidak ada destructive
cleanup database, volume Compose, atau credential dalam prosedur Harness ini.
