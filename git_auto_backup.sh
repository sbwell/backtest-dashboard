#!/bin/bash
cd /opt/chart_dashboard || exit
git add .
git diff --cached --quiet && exit 0  # Exit if nothing to commit
git commit -m "Auto backup $(date '+%Y-%m-%d %H:%M:%S')"
git push origin main
