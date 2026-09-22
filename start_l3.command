#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x .conda-web/bin/python ]; then
  echo "请先创建网页服务环境：conda env create --prefix .conda-web -f environment-web.yml"
  exit 1
fi
exec .conda-web/bin/python -m l3_workbench.server --port "${L3_PORT:-8873}" --open
