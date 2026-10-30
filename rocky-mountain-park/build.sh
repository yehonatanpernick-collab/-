#!/bin/sh
# Wraps park.html (artifact body) into a standalone page for GitHub Pages / local use.
cd "$(dirname "$0")"
{ printf '<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'; cat park.html; printf '\n</html>\n'; } > index.html
