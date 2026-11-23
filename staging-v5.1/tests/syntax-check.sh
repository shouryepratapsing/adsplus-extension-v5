#!/usr/bin/env sh
set -eu
node --check background.js
node --check content.js
node --check popup.js
node --check options.js
node -e "const m=require('./manifest.json'); if(m.manifest_version!==3 || !m.host_permissions.some(x=>x.includes('adsplus-api-staging'))) process.exit(1); console.log('manifest PASS')"
echo 'extension syntax PASS'
