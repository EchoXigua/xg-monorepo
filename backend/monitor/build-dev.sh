docker stop nest-manager-dev
docker rm nest-manager-dev
docker rmi nest-manager-dev
docker build -t nest-manager-dev . --no-cache
docker run -p 3302:3301 -p 3537:3536 -d --restart=always --name nest-manager-dev --network mynetwork -e RUN_ENV='dev'  nest-manager-dev 