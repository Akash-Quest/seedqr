#!/bin/sh
# Saves a compressed copy of the database. Run every night by
# seedcode-backup.timer; can also be run by hand:  sudo deploy/backup.sh
#
# The copies hold farmers' ID numbers: they are readable by root only.
# Keep a copy off this server too (for example an encrypted S3 bucket), since
# a copy on the same disk does not survive losing the disk.
set -eu
cd "$(dirname "$0")/.."

dir=${BACKUP_DIR:-/var/backups/seedcode}
keep_days=${BACKUP_DAYS:-7}

mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/seedcode-$(date +%Y-%m-%d-%H%M).sql.gz"

docker compose exec -T db pg_dump -U seedcode -d seedcode --no-owner | gzip -9 > "$file.part"
mv "$file.part" "$file"
chmod 600 "$file"

# Older copies go, so the disk never fills up.
find "$dir" -name 'seedcode-*.sql.gz' -mtime +"$keep_days" -delete
echo "Saved $file ($(du -h "$file" | cut -f1))"
