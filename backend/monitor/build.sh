docker stop nest-manager
docker rm nest-manager
docker rmi nest-manager
docker build -t nest-manager . --no-cache
docker run -p 3301:3301 -p 3536:3536 -d --restart=always --name nest-manager --network mynetwork -e RUN_ENV='dev'  nest-manager 