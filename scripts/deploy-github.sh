#!/bin/bash
pwd

# 创建用于部署的目录
mkdir -p gh-pages/manage
mkdir -p gh-pages/test

# 将构建后的文件复制到 gh-pages 目录下
if [ -d "frontend/manage-back-web/dist" ]; then
  cp -r frontend/manage-back-web/dist/* gh-pages/manage/
else
  echo "Directory frontend/manage-back-web/dist does not exist or is empty"
fi

if [ -d "frontend/test-demo/dist" ]; then
  cp -r frontend/test-demo/dist/* gh-pages/test/
else
  echo "Directory frontend/test-demo/dist does not exist or is empty"
fi

# 输出部署目录内容以确认
echo "Contents of gh-pages directory:"
ls -R gh-pages