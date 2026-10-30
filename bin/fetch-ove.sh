#!/bin/sh
# Download the Open Vector Editor (MIT, TeselaGen) and its sequence parsers for the sequence viewer of the database entries.
# They are not kept in the repository: run this once per installation (needs internet), the viewer page is web/sequence-viewer/index.php
set -eu

OVE_VERSION="0.8.42"
PARSERS_VERSION="0.4.37"
DEST="$(cd "$(dirname "$0")/.." && pwd)/web/sequence-viewer/vendor"

mkdir -p "$DEST"
curl -fsSL "https://unpkg.com/@teselagen/ove@${OVE_VERSION}/index.umd.js" -o "$DEST/ove.umd.js"
curl -fsSL "https://unpkg.com/@teselagen/ove@${OVE_VERSION}/ove.css" -o "$DEST/ove.css"
curl -fsSL "https://unpkg.com/@teselagen/bio-parsers@${PARSERS_VERSION}/index.umd.cjs" -o "$DEST/bio-parsers.umd.js"
echo "Open Vector Editor ${OVE_VERSION} and bio-parsers ${PARSERS_VERSION} are in ${DEST}"
