#!/bin/bash

# 定义项目的根目录
ROOT_DIR=$(pwd)

AFFECTED_PROJECTS=$(npx nx affected:apps --plain)
npx nx affected --target=build  --plain

echo 'deploy finish'