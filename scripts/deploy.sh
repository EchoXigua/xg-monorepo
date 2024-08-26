#!/bin/bash

# 定义项目的根目录
ROOT_DIR=$(pwd)

AFFECTED_PROJECTS=$(pnpm exec nx show projects --affected)

echo "受影响的项目: $AFFECTED_PROJECTS"

echo 'deploy finish'