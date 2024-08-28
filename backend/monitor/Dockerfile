FROM node:alpine AS production
ENV RUN_ENV=prod

COPY . /usr/src/app/nest-manager

WORKDIR /usr/src/app/nest-manager

RUN npm install  --registry=https://registry.npmmirror.com/
RUN npm run build

EXPOSE 3536 3301

CMD ["/bin/sh","./run.sh"]


