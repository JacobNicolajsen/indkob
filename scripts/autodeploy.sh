#!/bin/bash
# Auto-deploy: køres af cron hvert 5. minut på serveren.
# Henter nye commits fra GitHub; ved ændringer opdateres koden og appen genstartes.
# Opsætning i cPanel → Cron Jobs:
#   */5 * * * * /bin/bash $HOME/repositories/indkob/scripts/autodeploy.sh >> $HOME/autodeploy.log 2>&1

cd "$HOME/repositories/indkob" || exit 1

git fetch -q origin main || exit 1
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "=== $(date '+%F %T') deploy $LOCAL -> $REMOTE"
git merge --ff-only origin/main || exit 1

# npm install kun når package.json/package-lock.json er ændret (kør i nodevenv)
if git diff --name-only "$LOCAL" HEAD | grep -q '^package'; then
  source "$HOME"/nodevenv/repositories/indkob/*/bin/activate 2>/dev/null
  npm install --production
fi

# Genstart: restart.txt virker ikke på denne host — dræb lsnode, den respawner
pkill -9 -f lsnode || true
echo "=== deploy færdig"
