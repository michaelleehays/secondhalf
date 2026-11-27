#!/usr/bin/env bash
# Download MakeHuman's CC0 asset packs into assets/vendor/makehuman/ and unzip them there.
#
# The folder is gitignored: the system pack alone is about 280 MB and GitHub rejects files over
# 100 MB. build_athlete.py reads the unzipped assets from here (as MPFB's user data folder).
# Every pack is CC0; see assets/LICENSES.md. Safe to re-run: finished downloads are skipped.
set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vendor/makehuman"
BASE="https://files.makehumancommunity.org/asset_packs"
PACKS=(
  makehuman_system_assets/makehuman_system_assets_cc0.zip
  skins02/skins02_cc0.zip
  eyebrows01/eyebrows01_cc0.zip
  eyelashes01/eyelashes01_cc0.zip
)

mkdir -p "$DEST/zips"
for pack in "${PACKS[@]}"; do
  zip="$DEST/zips/$(basename "$pack")"
  if [[ ! -s "$zip" ]] || ! unzip -tq "$zip" >/dev/null 2>&1; then
    echo "Downloading $pack"
    curl -fL --retry 4 --retry-delay 5 -o "$zip.part" "$BASE/$pack"
    mv "$zip.part" "$zip"
  fi
  echo "Unzipping $(basename "$zip")"
  unzip -oq "$zip" -d "$DEST"
done
echo "MakeHuman assets ready in $DEST"
