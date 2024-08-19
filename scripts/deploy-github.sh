#!/bin/bash

# 创建用于部署的目录
mkdir -p ./gh-pages/manage
mkdir -p ./gh-pages/test

# 将每个项目的构建输出复制到指定的子目录
cp -R frontend/manage-back-web/dist/* ./gh-pages/manage/
cp -R frontend/test-demo/dist/* ./gh-pages/test/

# 输出部署目录内容以确认
echo "Contents of gh-pages directory:"
ls -R ./gh-pages